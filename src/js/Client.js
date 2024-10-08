

import getUserLocale from 'get-user-locale';

import { API } from "./API";
import { ButtonApiModal } from "./Buttons";
import { LinkPage } from './Links';
import { GridSearch, GridSearchTags } from "./Grid";
import { SwitchDarkMode } from "./Switch";
import { Recipe } from "./Recipe";

class Client {

    constructor() {
        this.__pages = ["home", "search", "parse", "add", "delete", "recipe"];
        this._api = new API("none", { backend: "http://localhost:7090"});
        this._language = getUserLocale();
        
        const url = this._api.createUrl("/public/languages.json");
        this._api.fetch("GET", url)
        .then((json) => { 
            this._tableLanguages = json;

            // Navbar
            this._linkHome = new LinkPage(this, "link-home", "home-content");
            this._linkSearch = new LinkPage(this, "link-search", "search-content");
            this._linkParse = new LinkPage(this, "link-parse", "parse-content");
            this._linkAdd = new LinkPage(this, "link-add", "add-content");
            this._switchDarkMode = new SwitchDarkMode("dark-mode-switch", "html-main");
            // Set selected language according to browser 
            document.getElementById("language-selection").textContent = this._tableLanguages["languages"][this._language];

            // Search page
            this._searchTags = new GridSearchTags(this, "search-grid-tag");
            this._search = new GridSearch(this, "search-grid", "search-input");
            // Parse page
            this._parse = new ButtonApiModal(this, "parse-button", undefined, "parse-modal");
            this._parse.addClickFunction(async (event) => {
                event.preventDefault();

                // Send url to backend
                const elementUrl = document.getElementById("parse-url")
                const urlRecipe = elementUrl.value;
                const urlServer = this._api.createUrl("/parse");
                const payload = {
                    url: urlRecipe
                }
                const result = await this._api.fetch("POST", urlServer, payload);
                
                // Check result and report back to user
                if (result && result._id) {
                    elementUrl.textContent = "";
                    this._recipe.addRecipeToPage(result._id);
                    this.setPage("recipe");
                }
            })
            // Recipe page
            this._recipe = new Recipe(this, "recipe-content");
        })
        .catch((error) => console.error(error));
    }

    init() {
        this.setPage("home");    
    }

    /**
     * 
     * @param { String } page 
     */
    setPage(page) {
        for (const id of this.__pages) {
            const div = document.getElementById(`${id}-content`);
            if (id === page) {
                div.hidden = false;
                continue;
            }
            div.hidden = true;
        }
    }

    /**
     * 
     * @param { String } language -  
     */
    setLanguage(language) {
        console.log(`Set languange to ${language}`);
        this._language = language;
        document.getElementById("language-selection").textContent = this._tableLanguages["languages"][this._language];
        this._searchTags.setLanguage();
    }

    getWord(word, table, setFirstUpperCase = true) {
        const lookup = word.toLowerCase();
        let text = this._tableLanguages[table][lookup][this._language];
        if (setFirstUpperCase) text = text[0].toUpperCase() + text.slice(1);
        return text;
    }

    /**
     * Return 
     * @param { } color - 
     * @param { Number } percent - 
     * @returns { } 
     */
    createLighterColor(color, percent) {
        const num = parseInt(color.replace("#", ""), 16),
            amt = Math.round(2.55 * percent),
            R = (num >> 16) + amt,
            G = (num >> 8 & 0x00FF) + amt,
            B = (num & 0x0000FF) + amt;
        return `#${(
            0x1000000 +
            (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
            (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
            (B < 255 ? (B < 1 ? 0 : B) : 255))
            .toString(16)
            .slice(1)}`;
    }

}

export {
    Client
}