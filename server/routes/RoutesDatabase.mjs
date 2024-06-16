import { ObjectId } from "mongodb";
import { httpError } from "http-errors";

import { __FILE_BUCKET_NAME } from "../plugins/Mongodb.mjs";

export default async (fastify) => {

    const _validateObjectId = (id) => {
        return (ObjectId.isValid(id)) ? id : ObjectId(id);
    }

    const handleUploadFile = async (id, request) => {
        return new Promise(async (resolve, reject) => {
            const filename = request.query.filename;
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
            // Add new file
            let metadata = { id, created: new Date() };
            try {
                metadata = JSON.parse(request.query.metadata ?? "{}");
            } catch (error) {
                return reject(httpError(400, `Invalid metadata: ${error}`));
            }
            // Upload file to filebucket
            const stream = await fastify.mongo.fileBucket.openUploadStream(filename, { metadata });
            stream.on("error", async (error) => {
                console.error(`GridFS upload stream failed. Calling abort to delete chunks. (reason: ${error})`);
                try {
                    await stream.abort();
                } catch (abortError) {
                    console.error(`Abort failed: ${error}`);
                }
                return reject(error);
            });
            stream.on("finish", async (object) => {
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
                } catch (error) /* istanbul ignore next: This should only happen if the connection
                                   to the database dies or something similar. Hard to test. */ {
                    console.error(`Error updating metadata for file ${id}: ${error}`);
                    console.error(error);
                    return reject(httpError(500, error));
                }
            });
            request.body.pipe(stream);
        });
    };

    fastify.post("/files", async (request) => {
        const id = new ObjectId();
        return handleUploadFile(id, request);
    });

    fastify.get("/files/:id", async (request) => {
        const id = _validateObjectId(request.params.id);
        const file = await fastify.mongo.db
            .collection(`${__FILE_BUCKET_NAME}.files`)
            .findOne({ "metadata.id": id });
        if (!file) {
            throw httpError(404, `File ${id} not found`);
        }
        return file;
    });

    fastify.get("/files/:id/download", async (request) => {
        const id = _validateObjectId(request.params.id);
        const file = await fastify.mongo.db
            .collection(`${__FILE_BUCKET_NAME}.files`)
            .findOne({ "metadata.id": id });
        if (!file) {
            throw httpError(404, `File ${id} not found`);
        }
        return fastify.mongo.fileBucket.openDownloadStream(file._id);
    });

    
};
