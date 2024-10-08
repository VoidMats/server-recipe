import { promises, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import httpError from "http-errors";

import fastifyPlugin from "fastify-plugin";
import { MongoClient, MongoError, GridFSBucket } from "mongodb";
import mongodbURI from "mongodb-uri";

// TODO Move this to decorate
const __FILE_BUCKET_NAME = "__image_filebucket";
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const db = fastifyPlugin(
    async(fastify, config) => {
        const uri = {
            username: config.MONGO_USERNAME,
            password: config.MONGO_PASSWORD,
            hosts: [
                {
                    host: config.MONGO_HOST,
                    port: config.MONGO_PORT
                }
            ],
            database: config.MONGO_DATABASE,
            options: {
                authSource: config.MONGO_AUTH
            }
        }
        const url = mongodbURI.format(uri);
        const options = {
            family: config.MONGO_FAMILY
        };

        const client = new MongoClient(url, options);
        await client.connect();
        const db = client.db();
        const info = await db.command({ whatsmyuri: 1});
        console.log(`  - Connect to mongodb '${db.databaseName}' on ip: ${info.you}, status: ${(info.ok) ? "true" : "false"}`);

        // Add schemas 
        const pathComplete = path.join(__dirname, "../../schemas/database");
        if (!existsSync(pathComplete)) {
            console.error("Path/Folder for schemas does not exist");
            process.exit(2);
        };

        const createCollection = async (name, schema) => {
            // Add collection to database if missing
            try {
                await db.command({ collMod: name, validator: { $jsonSchema: schema }});
            } catch(error) {
                // Collection doesn't exist
                if (error instanceof MongoError && error.codeName === "NamespaceNotFound") {
                    console.log(`  - Collection '${name}' does not exist and will be created`)
                    await db.createCollection(name, {
                        validator: { $jsonSchema: schema },
                    });
                } else {
                    console.error(error);
                    process.exit(2);
                }
            }
        } 
    
        let fileBucket;
        const pathSchemas = await promises.readdir(pathComplete); 
        for (const pathSchema of pathSchemas) {
            let name = path.basename(pathSchema).split(".")[0];
            const schema = JSON.parse(readFileSync(path.join(pathComplete, pathSchema)));
            
            // Check for filebucket
            if (name === "file") {
                name = `${__FILE_BUCKET_NAME}.files`;
                fileBucket = new GridFSBucket(db, { bucketName: __FILE_BUCKET_NAME });
                await createCollection(name, schema);
            }

            // Check for recipe, which need to be a collection for each language
            if (name === "recipe") {
                for (const language of config.SERVER_LANGUAGES) {
                    const dbName = `${name}-${language.toLowerCase()}`;
                    await createCollection(dbName, schema);
                }
            } 
        }
        
        console.log("  - All database schemas was read from folder");

        console.log("  - Add methods to db");
        db.readError = (error) => {
            if (error.code === 121) {
                console.error(error.errInfo.details);
                console.error(error.errInfo.details.schemaRulesNotSatisfied.toString())
                console.error(JSON.stringify(error.errorResponse.errInfo));
                // TODO create a proper error message which is human readable
                //return `Validation error: ${error.errorResponse}`;
                return error.errorResponse;
            }
            return (error.errorResponse) ? error.errorResponse : error;
        };

        db.uploadFile = async (id, filename, userMetadata, inputStream) => {
            return new Promise(async (resolve, reject) => {
                if (!filename) {
                    return reject(httpError(400, `filename is missing from query`));
                }
                // Check for existing file
                const existingFile = await db
                    .collection(`${__FILE_BUCKET_NAME}.files`)
                    .findOne({ "metadata.id": id });
                if (existingFile) {
                    return reject(httpError(403, `A file with id ${id} already exists.`));
                }
                // Add new file
                let metadata = { id, created: new Date() };
                try {
                    if (userMetadata instanceof String) {
                        metadata = JSON.parse(userMetadata ?? "{}");
                    } else {
                        metadata = userMetadata;
                    }
                } catch (error) {
                    return reject(httpError(400, `Invalid metadata: ${error}`));
                }
                // Upload file to filebucket
                const outputStream = await fileBucket.openUploadStream(filename, { metadata });
                outputStream.on("error", async (error) => {
                    console.error(`GridFS upload stream failed. Calling abort to delete chunks. (reason: ${error})`);
                    try {
                        await stream.abort();
                    } catch (abortError) {
                        console.error(`Abort failed: ${error}`);
                    }
                    return reject(error);
                });
                outputStream.on("finish", async (object) => {
                    try {
                        console.log(object)
                        if (object) {
                            await fastify.mongo.db.collection(`${__FILE_BUCKET_NAME}.files`).updateOne(
                                { _id: object._id },
                                {
                                    $set: {
                                        "metadata.id": id,
                                    },
                                },
                            );
                            resolve({ id });
                        } else {
                            //reject(`No object from uploaded file`);
                            resolve({ id });
                        }
                    } catch (error) {
                        console.error(`Error updating metadata for file ${id}: ${error}`);
                        console.error(error);
                        return reject(httpError(500, error));
                    }
                });
                inputStream.pipe(outputStream);
            });
        };

        fastify.addHook("onClose", () => {
            console.log("==> Closing database");
            client.close();
        });

        fastify.decorate("mongo", { db, client, fileBucket });
    },
    {
        name: "mongo"
    }
)



export {
    __FILE_BUCKET_NAME,
    db
}