//import 'dotenv/config';
//import dotenv from "dotenv";
//const test = import.meta.url;

export class API {
    /**
     * 
     * @param { String } auth 
     * @param { Object } options - Option object for the API
     * @param { String } options.version - Override the version of the backend 
     * @param { String } options.backend - Override the backend ip
     */
    constructor(auth = "none", options = {}) {
        const { version, backend } = options;
        this._token = null;
        this._auth = auth;
        this.location = document.location;
        //this.port = process.env.SERVER_PORT;
        this.version = version || "v1";
        if (backend) {
            this.backend = backend;
        } else {
            this.backend = `${this.location.origin}`
        }
    }

    createUrl(route, queries = {}) {
        const url = new URL(this.backend);
        if (/^\/v\d{1}/.test(route)) {
            url.pathname = route;
        } else {
            url.pathname = `/${this.version}${route}`;
        }
        for (const [key, value] of Object.entries(queries)) {
            url.searchParams.set(key, value);
        }
        return url;
    }

    /**
     * 
     * @param { String } method 
     * @param { String | URL } url 
     * @param { Object } payload 
     * @param { Object } signal 
     * @returns 
     */
    async fetch(method, url, payload, signal) {
        const headers = {};
        const options = {};

        options["method"] = method.toUpperCase();

        if (signal) options["signal"] = signal;
        if (this._auth === "basic") headers["Authorization"] = `Bearer ${this._token}`;
        if (this._httpsAgent) method["agent"] = this._httpsAgent;
        
        if (payload) {
            options["body"] = JSON.stringify(payload);
            headers["Content-Type"] = "application/json";
        }
        options['headers'] = headers;

        // Validate url
        let checkedUrl;
        if (url instanceof URL) {
            checkedUrl = url;
        } else {
            try {
                checkedUrl = new URL(url);
            } catch(error) {
                checkedUrl = new URL(url, `${this.backend}/${this.version}`)
            }
        }

        try {
            const response = await fetch(checkedUrl, options);
            return await this._checkStatus(response);
        } catch(error) {
            console.log(error);
        }
    }

    async _checkStatus(response) {
        if (response.ok) {
            const type = (response.headers) ? response.headers.get("Content-Type") : undefined;
            console.log(type);
            switch (type?.toLowerCase().replaceAll(' ', '')) {
                case "application/json;charset=utf-8":
                case "application/json":
                    return response.json();
                case "application/octet-stream":
                    return response.body;
                case "text/plain;charset=utf-8":
                case "text/plain":
                    return response.text();
                case "text/html;charset=utf-8":
                case "text/html":
                    return response.text();
                default:
                    return response;
            }
        } 
        if (response.status === 401) {
            let answer
            this._counter += 1;
            if (this._counter > 1) {
                answer = {
                    timestamp: new Date().toLocaleString(),
                    success: false,
                    code: 401,
                    error: "User has not access to this plan"
                }
                this._counter = 0;
            }
            this._updateToken(true);
            answer = {
                timestamp: new Date().toLocaleString(),
                success: false,
                code: 401,
                error: `${response.statusText} - `,
            }
            return answer;
        } 
        if (response.status > 401) {
            let errorMessage = {
                timestamp: new Date().toLocaleString(),
                success: false,
                code: response.status,
                error: response.statusText
            }
            console.error( `<== Error: ${response.url} - ${response.status} - ${response.statusText}`);
            const type = (response.headers) ? response.headers.get("content-type") : undefined;
            if (type === "application/json; charset=utf-8" || type === "application/json") {
                const answer = await response.json();
                errorMessage.code = answer.statusCode;
                errorMessage.error = answer.message;
                errorMessage["referenceId"] = answer.referenceId;
            }
            return errorMessage;
        } else {
            this._counter = 0;
            throw new Error(`<== Unknown error in plugin splan - fetching error: ${response.statusText}`);
        }
    }

    addAuthorization(username, password) {
        this._token = btoa(`${username}:${password}`);
    }
}