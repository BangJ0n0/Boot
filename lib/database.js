const fs = require("fs");
const chalk = require("chalk");
const { connectDatabase, BotState, readLegacyJsonDb, getStorageMode, LEGACY_JSON_PATH } = require("../db.js");

class DataBase {
    constructor(key = "main") {
        this.key = key;
        this.data = {};
        this.doc = null;
    }

    async ensureDoc() {
        await connectDatabase();

        if (getStorageMode() !== "mongo") {
            return null;
        }

        if (this.doc && this.doc._id) {
            return this.doc;
        }

        let doc = await BotState.findOne({ key: this.key });
        if (!doc) {
            const legacyData = readLegacyJsonDb();
            doc = await BotState.create({
                key: this.key,
                data: legacyData && Object.keys(legacyData).length ? legacyData : {}
            });

            if (legacyData && Object.keys(legacyData).length) {
                console.log(chalk.green("[Mongo] Bot state berhasil di-seed dari database JSON lama."));
            }
        }

        this.doc = doc;
        return doc;
    }

    read = async () => {
        try {
            await connectDatabase();
            if (getStorageMode() !== "mongo") {
                this.data = readLegacyJsonDb();
                return this.data;
            }

            const doc = await this.ensureDoc();
            this.data = doc.data || {};
            return this.data;
        } catch (error) {
            console.error(chalk.red("MongoDB Read Error:"), error);
            return {};
        }
    }

    write = async (data) => {
        try {
            await connectDatabase();
            if (getStorageMode() !== "mongo") {
                const nextData = data || global.db || {};
                fs.writeFileSync(LEGACY_JSON_PATH, JSON.stringify(nextData, null, 2));
                this.data = nextData;
                return nextData;
            }

            const doc = await this.ensureDoc();
            doc.data = data || global.db || {};
            doc.markModified("data");
            await doc.save();
            this.data = doc.data;
            return doc;
        } catch (error) {
            console.error(chalk.red("MongoDB Write Error:"), error);
            return null;
        }
    }
}

module.exports = DataBase;
