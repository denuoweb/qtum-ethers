"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HtmlcoinWallet = exports.defaultPath = exports.SLIP_BIP44_PATH = exports.HTMLCOIN_BIP44_PATH = void 0;
const utils_1 = require("ethers/lib/utils");
const bignumber_js_1 = require("bignumber.js");
const ethers_1 = require("ethers");
const utils_2 = require("./helpers/utils");
const global_vars_1 = require("./helpers/global-vars");
const IntermediateWallet_1 = require("./helpers/IntermediateWallet");
const utils_3 = require("./helpers/utils");
const properties_1 = require("@ethersproject/properties");
const json_wallets_1 = require("@ethersproject/json-wallets");
const hdnode_1 = require("@ethersproject/hdnode");
const bytes_1 = require("@ethersproject/bytes");
const random_1 = require("@ethersproject/random");
const keccak256_1 = require("@ethersproject/keccak256");
const logger = new utils_1.Logger("HtmlcoinWallet");
const forwardErrors = [
    utils_1.Logger.errors.INSUFFICIENT_FUNDS
];
// Htmlcoin core wallet and electrum use coin 88
exports.HTMLCOIN_BIP44_PATH = "m/44'/88'/0'/0/0";
// Other wallets use coin 172
// for more details, see: https://github.com/satoshilabs/slips/pull/196
exports.SLIP_BIP44_PATH = "m/44'/172'/0'/0/0";
exports.defaultPath = exports.SLIP_BIP44_PATH;
class HtmlcoinWallet extends IntermediateWallet_1.IntermediateWallet {
    constructor(privateKey, provider) {
        super(privateKey, provider);
    }
    async serializeTransaction(utxos, neededAmount, tx, transactionType) {
        return await utils_2.serializeTransaction(utxos, neededAmount, tx, transactionType, this.privateKey, this.compressedPublicKey);
    }
    /**
     * Override to build a raw HTMLCOIN transaction signing UTXO's
     */
    async signTransaction(transaction) {
        if (!transaction.gasPrice) {
            // 40 satoshi in WEI
            // 40 => 40000000000
            transaction.gasPrice = "0x9502f9000";
        }
        // convert gasPrice into satoshi
        let gasPrice = new bignumber_js_1.BigNumber(ethers_1.BigNumber.from(transaction.gasPrice).toString() + 'e-9');
        transaction.gasPrice = gasPrice.toNumber();
        const tx = await utils_1.resolveProperties(transaction);
        // Refactored to check TX type (call, create, p2pkh, deploy error) and calculate needed amount
        const { transactionType, neededAmount } = utils_2.checkTransactionType(tx);
        // Check if the transactionType matches the DEPLOY_ERROR, throw error else continue
        if (transactionType === global_vars_1.GLOBAL_VARS.DEPLOY_ERROR) {
            return logger.throwError("You cannot send HTMLCOIN while deploying a contract. Try deploying again without a value.", utils_1.Logger.errors.NOT_IMPLEMENTED, {
                error: "You cannot send HTMLCOIN while deploying a contract. Try deploying again without a value.",
            });
        }
        let utxos = [];
        try {
            // @ts-ignore
            utxos = await this.provider.getUtxos(tx.from, neededAmount);
            // Grab vins for transaction object.
        }
        catch (error) {
            if (forwardErrors.indexOf(error.code) >= 0) {
                throw error;
            }
            return logger.throwError("Needed amount of UTXO's exceed the total you own.", utils_1.Logger.errors.INSUFFICIENT_FUNDS, {
                error: error,
            });
        }
        const { serializedTransaction, networkFee } = await this.serializeTransaction(utxos, neededAmount, tx, transactionType);
        if (networkFee !== "") {
            let updatedNeededAmount;
            try {
                // Try again with the network fee included
                updatedNeededAmount = new bignumber_js_1.BigNumber(neededAmount).plus(networkFee);
                // @ts-ignore
                utxos = await this.provider.getUtxos(tx.from, updatedNeededAmount);
                // Grab vins for transaction object.
            }
            catch (error) {
                if (forwardErrors.indexOf(error.code) >= 0) {
                    throw error;
                }
                return logger.throwError("Needed amount of UTXO's exceed the total you own.", utils_1.Logger.errors.INSUFFICIENT_FUNDS, {
                    error: error,
                });
            }
            const serialized = await this.serializeTransaction(utxos, updatedNeededAmount.toString(), tx, transactionType);
            if (serialized.serializedTransaction === "") {
                throw new Error("Failed to generate vouts");
            }
            return serialized.serializedTransaction;
        }
        return serializedTransaction;
    }
    connect(provider) {
        return new HtmlcoinWallet(this, provider);
    }
    /**
     *  Static methods to create Wallet instances.
     */
    static createRandom(options) {
        let entropy = random_1.randomBytes(16);
        if (!options) {
            options = {};
        }
        if (options.extraEntropy) {
            entropy = bytes_1.arrayify(bytes_1.hexDataSlice(keccak256_1.keccak256(bytes_1.concat([entropy, options.extraEntropy])), 0, 16));
        }
        const mnemonic = hdnode_1.entropyToMnemonic(entropy, options.locale);
        return HtmlcoinWallet.fromMnemonic(mnemonic, options.path, options.locale);
    }
    static fromEncryptedJson(json, password, progressCallback) {
        return json_wallets_1.decryptJsonWallet(json, password, progressCallback).then((account) => {
            return new HtmlcoinWallet(account);
        });
    }
    static fromEncryptedJsonSync(json, password) {
        return new HtmlcoinWallet(json_wallets_1.decryptJsonWalletSync(json, password));
    }
    /**
     * Create a HtmlcoinWallet from a BIP44 mnemonic
     * @param mnemonic
     * @param path HTMLCOIN uses two different derivation paths and recommends SLIP_BIP44_PATH for external wallets, core wallets use HTMLCOIN_BIP44_PATH
     * @param wordlist
     * @returns
     */
    static fromMnemonic(mnemonic, path, wordlist) {
        if (!path) {
            path = exports.defaultPath;
        }
        const hdnode = hdnode_1.HDNode.fromMnemonic(mnemonic, "", wordlist).derivePath(path);
        // HTMLCOIN computes address from the public key differently than ethereum, ethereum uses keccak256 while HTMLCOIN uses ripemd160(sha256(compressedPublicKey))
        // @ts-ignore
        properties_1.defineReadOnly(hdnode, "htmlcoinAddress", utils_3.computeAddress(hdnode.publicKey, true));
        return new HtmlcoinWallet(hdnode);
    }
}
exports.HtmlcoinWallet = HtmlcoinWallet;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUXR1bVdhbGxldC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9saWIvUXR1bVdhbGxldC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw0Q0FHMEI7QUFFMUIsK0NBQXdDO0FBQ3hDLG1DQUFzRDtBQUN0RCwyQ0FBbUc7QUFDbkcsdURBQW1EO0FBQ25ELHFFQUFpRTtBQUNqRSwyQ0FBK0M7QUFDL0MsMERBQTJEO0FBQzNELDhEQUF5RztBQUN6RyxrREFBa0U7QUFDbEUsZ0RBQTZFO0FBQzdFLGtEQUFvRDtBQUNwRCx3REFBcUQ7QUFHckQsTUFBTSxNQUFNLEdBQUcsSUFBSSxjQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDeEMsTUFBTSxhQUFhLEdBQUc7SUFDbEIsY0FBTSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0I7Q0FDbkMsQ0FBQztBQUVGLDRDQUE0QztBQUMvQixRQUFBLGVBQWUsR0FBRyxrQkFBa0IsQ0FBQztBQUNsRCw4QkFBOEI7QUFDOUIsdUVBQXVFO0FBQzFELFFBQUEsZUFBZSxHQUFHLG9CQUFvQixDQUFDO0FBQ3ZDLFFBQUEsV0FBVyxHQUFHLHVCQUFlLENBQUM7QUFFM0MsTUFBYSxVQUFXLFNBQVEsdUNBQWtCO0lBRTlDLFlBQVksVUFBZSxFQUFFLFFBQWM7UUFDdkMsS0FBSyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUNoQyxDQUFDO0lBRVMsS0FBSyxDQUFDLG9CQUFvQixDQUFDLEtBQWlCLEVBQUUsWUFBb0IsRUFBRSxFQUFzQixFQUFFLGVBQXVCO1FBQ3pILE9BQU8sTUFBTSw0QkFBb0IsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLEVBQUUsRUFBRSxlQUFlLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQztJQUMzSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFdBQStCO1FBQ2pELElBQUksQ0FBQyxX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
