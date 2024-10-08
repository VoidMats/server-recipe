import pkg from 'http-errors';
import { ObjectId } from "mongodb";

const { httpError } = pkg;

// Move this to decorate
import { __FILE_BUCKET_NAME } from "../plugins/Mongodb.mjs";
import createHttpError from 'http-errors';

export default async (fastify) => {

    const _validateObjectId = (id) => {
        if (id instanceof ObjectId) {
            return id;
        }
        if (ObjectId.isValid(id)) {
            return new ObjectId(id);
        }
        throw new Error('Invalid ObjectId');
    };

    const _createAnswer = (success = false, result, error) => {
        const answer = { 
            timestamp: new Date().toLocaleDateString(), 
            success: success,
            result: undefined,
            code: undefined,
            error: undefined  
        };
        if (result) {
            answer.result = result;
            answer.code = 200;
            answer.error = "No error";
        }
        if (error) {
            answer.code = error.statusCode;
            answer.error = `${error.code} - ${error.message}`;
        }
        return answer;
    }

    const handleUploadFile = async (id, filename, metadata = {}, inputStream) => {
        return new Promise(async (resolve, reject) => {
            if (!filename) {
                return reject(httpError(400, `filename is missing from query`));
            }
            // Check for existing file
            const existingFile = await fastify.mongo.db
                .collection(`${__FILE_BUCKET_NAME}.files`)
                .findOne({ "metadata.id": id });
            if (existingFile) {
                return reject(httpError(403, `A file with id ${id} already exists.`));
            }
            // Upload file to filebucket
            const outputStream = await fastify.mongo.fileBucket.openUploadStream(filename, { metadata });
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
                    await fastify.mongo.db.collection(`${__FILE_BUCKET_NAME}.files`).updateOne(
                        { _id: object._id },
                        {
                            $set: {
                                "metadata.id": id,
                            },
                        },
                    );
                    resolve({ id });
                } catch (error) {
                    console.error(`Error updating metadata for file ${id}: ${error}`);
                    console.error(error);
                    return reject(httpError(500, error));
                }
            });
            inputStream.pipe(outputStream);
        });
    };

    fastify.post("/file", async (request) => {
        const id = new ObjectId();
        const filename = request.query.filename;
        let metadata = { id, created: new Date() };
        try {
            metadata = JSON.parse(request.query.metadata ?? "{}");
        } catch(error) {
            httpError(400, `Invalid metadata: ${error}`);
        }
        return await fastify.mongo.uploadFile(id, filename, metadata, request.body);
    });

    fastify.get("/file/:id", async (request) => {
        const id = _validateObjectId(request.params.id);
        const file = await fastify.mongo.db
            .collection(`${__FILE_BUCKET_NAME}.files`)
            .findOne({ "metadata.id": id });
        if (!file) {
            throw httpError(404, `File ${id} not found`);
        }
        return file;
    });

    fastify.get("/file/:id/download", async (request) => {
        const id = _validateObjectId(request.params.id);
        const file = await fastify.mongo.db
            .collection(`${__FILE_BUCKET_NAME}.files`)
            .findOne({ "metadata.id": id });
        if (!file) {
            throw httpError(404, `File ${id} not found`);
        }
        return fastify.mongo.fileBucket.openDownloadStream(file._id);
    });

    // Recipe routes

    /**
     * 
     * @returns { { acknowleged, insertedId } } 
     */
    fastify.post("/recipe", async (request) => {
        const document = request.body;
        const { language } = request.query;
        document._id = _validateObjectId(document._id);
        try {
            const result = await fastify.mongo.db.collection(`recipe-${language.toLowerCase()}`).insertOne(document);
            return _createAnswer(true, result);
        } catch(error) {
            return createHttpError(500, error);
        }
    });

    /**
     * @returns { }
     */
    fastify.get("/recipe/:id", async (request) => {
        const id = _validateObjectId(request.params.id);
        const { language } = request.query;
        const recipe = await fastify.mongo.db.collection(`recipe-${language.toLowerCase()}`).findOne({ _id: id });
        if (!recipe) {
            const error = createHttpError(404, `Recipe ${id} not found`);
            return _createAnswer(false, undefined, error);
        }
        return _createAnswer(true, recipe);
    });

    /**
     * @param { String } query.language - Country code for the language where the recipe is located
     * @returns { }
     */
    fastify.delete("/recipe/:id", async (request) => {
        const id = _validateObjectId(request.params.id);
        const { language } = request.query;
        const response = await fastify.mongo.db.collection(`recipe-${language.toLowerCase()}`).deleteOne({ _id: id });
        if (!response.acknowledged || response.deletedCount !== 1) {
            const error = createHttpError(404, `Recipe ${id} not found`);
            return _createAnswer(false, undefined, error);
        }
        return _createAnswer(true, response);
    });

    /**
     * Route to search for recipes. 
     * @param { Object } query - request.query
     * @param { String } query.text - Search text in title
     * @param { Array } query.ingredients - Array of ingredients that the recipe need to have.
     * @param { String } query.language - Country code for the langauge to use for the search.
     * @returns { Array } Returns an array with recipes from the search critera 
     */
    fastify.get("/recipe/search", async (request) => {
        const { text, ingredients, language } = request.query;

        const query = { title: { "$regex": `${text}`, "$options": "i" } };
    
        if (ingredients) {
            const array = ingredients.split(',');
            if (array.length > 0) {
                query["components.ingredients"] = {
                    "$all": array.map(ingredient => ({
                        "$elemMatch": { ingredient: { "$regex": ingredient, "$options": "i" } }
                    }))
                };
            }
        }

        try {
            const recipes = await fastify.mongo.db.collection(`recipe-${language.toLowerCase()}`)
            .find(query).toArray();
            return _createAnswer(true, recipes);
        } catch(error) {
            console.error(error);
            // TODO best would be to use the database plugin return http response
            return createHttpError(500, error);
        }
    });

};
