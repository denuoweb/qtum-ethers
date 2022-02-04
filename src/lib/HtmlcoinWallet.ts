import {
    resolveProperties,
    Logger,
} from "ethers/lib/utils";
import { Provider, TransactionRequest } from "@ethersproject/abstract-provider";
import { BigNumber } from "bignumber.js"
import { BigNumber as BigNumberEthers } from "ethers";
import { checkTransactionType, serializeTransaction, SerializedTransaction } from './helpers/utils'
import { GLOBAL_VARS } from './helpers/global-vars'
import { IntermediateWallet } from './helpers/IntermediateWallet'
import { computeAddress} from "./helpers/utils"
import { defineReadOnly } from "@ethersproject/properties";
import { decryptJsonWallet, decryptJsonWalletSync, ProgressCallback } from "@ethersproject/json-wallets";
import { HDNode, entropyToMnemonic } from "@ethersproject/hdnode";
import { arrayify, Bytes, concat, hexDataSlice } from "@ethersproject/bytes";
import { randomBytes } from "@ethersproject/random";
import { keccak256 } from "@ethersproject/keccak256";
import { Wordlist } from "@ethersproject/wordlists";

const logger = new Logger("HtmlcoinWallet");
const forwardErrors = [
    Logger.errors.INSUFFICIENT_FUNDS
];

// Htmlcoin core wallet and electrum use coin 88
export const HTMLCOIN_BIP44_PATH = "m/44'/88'/0'/0/0";
// Other wallets use coin 172
// for more details, see: https://github.com/satoshilabs/slips/pull/196
export const SLIP_BIP44_PATH = "m/44'/172'/0'/0/0";
export const defaultPath = SLIP_BIP44_PATH;

export class HtmlcoinWallet extends IntermediateWallet {

    constructor(privateKey: any, provider?: any) {
        super(privateKey, provider);
    }

    protected async serializeTransaction(utxos: Array<any>, neededAmount: string, tx: TransactionRequest, transactionType: number): Promise<SerializedTransaction> {
        return await serializeTransaction(utxos, neededAmount, tx, transactionType, this.privateKey, this.compressedPublicKey);
    }

    /**
     * Override to build a raw HTMLCOIN transaction signing UTXO's
     */
    async signTransaction(transaction: TransactionRequest): Promise<string> {
        if (!transaction.gasPrice) {
            // 40 satoshi in WEI
            // 40 => 40000000000
            transaction.gasPrice = "0x9502f9000";
        }

        // convert gasPrice into satoshi
        let gasPrice = new BigNumber(BigNumberEthers.from(transaction.gasPrice).toString() + 'e-9');
        transaction.gasPrice = gasPrice.toNumber();

        const tx = await resolveProperties(transaction);

        // Refactored to check TX type (call, create, p2pkh, deploy error) and calculate needed amount
        const { transactionType, neededAmount } = checkTransactionType(tx);

        // Check if the transactionType matches the DEPLOY_ERROR, throw error else continue
        if (transactionType === GLOBAL_VARS.DEPLOY_ERROR) {
            return logger.throwError(
                "You cannot send HTMLCOIN while deploying a contract. Try deploying again without a value.",
                Logger.errors.NOT_IMPLEMENTED,
                {
                    error: "You cannot send HTMLCOIN while deploying a contract. Try deploying again without a value.",
                }
            );
        }

        let utxos = [];
        try {
            // @ts-ignore
            utxos = await this.provider.getUtxos(tx.from, neededAmount);
            // Grab vins for transaction object.
        } catch (error: any) {
            if (forwardErrors.indexOf(error.code) >= 0) {
                throw error;
            }
            return logger.throwError(
                "Needed amount of UTXO's exceed the total you own.",
                Logger.errors.INSUFFICIENT_FUNDS,
                {
                    error: error,
                }
            );
        }

        const { serializedTransaction, networkFee } = await this.serializeTransaction(utxos, neededAmount, tx, transactionType);

        if (networkFee !== "") {
            let updatedNeededAmount;
            try {
                // Try again with the network fee included
                updatedNeededAmount = new BigNumber(neededAmount).plus(networkFee);
                // @ts-ignore
                utxos = await this.provider.getUtxos(tx.from, updatedNeededAmount);
                // Grab vins for transaction object.
            } catch (error: any) {
                if (forwardErrors.indexOf(error.code) >= 0) {
                    throw error;
                }
                return logger.throwError(
                    "Needed amount of UTXO's exceed the total you own.",
                    Logger.errors.INSUFFICIENT_FUNDS,
                    {
                        error: error,
                    }
                );
            }
            const serialized = await this.serializeTransaction(utxos, updatedNeededAmount.toString(), tx, transactionType);
            if (serialized.serializedTransaction === "") {
                throw new Error("Failed to generate vouts");
            }
            return serialized.serializedTransaction;
        }

        return serializedTransaction;
    }

    connect(provider: Provider): IntermediateWallet {
        return new HtmlcoinWallet(this, provider);
    }

    /**
     *  Static methods to create Wallet instances.
     */
    static createRandom(options?: any): IntermediateWallet {
        let entropy: Uint8Array = randomBytes(16);

        if (!options) { options = { }; }

        if (options.extraEntropy) {
            entropy = arrayify(hexDataSlice(keccak256(concat([ entropy, options.extraEntropy ])), 0, 16));
        }

        const mnemonic = entropyToMnemonic(entropy, options.locale);
        return HtmlcoinWallet.fromMnemonic(mnemonic, options.path, options.locale);
    }

    static fromEncryptedJson(json: string, password: Bytes | string, progressCallback?: ProgressCallback): Promise<IntermediateWallet> {
        return decryptJsonWallet(json, password, progressCallback).then((account) => {
            return new HtmlcoinWallet(account);
        });
    }

    static fromEncryptedJsonSync(json: string, password: Bytes | string): IntermediateWallet {
        return new HtmlcoinWallet(decryptJsonWalletSync(json, password));
    }

    /**
     * Create a HtmlcoinWallet from a BIP44 mnemonic
     * @param mnemonic
     * @param path HTMLCOIN uses two different derivation paths and recommends SLIP_BIP44_PATH for external wallets, core wallets use HTMLCOIN_BIP44_PATH
     * @param wordlist
     * @returns
     */
    static fromMnemonic(mnemonic: string, path?: string, wordlist?: Wordlist): IntermediateWallet {
        if (!path) { path = defaultPath; }
        const hdnode = HDNode.fromMnemonic(mnemonic, "", wordlist).derivePath(path)
        // HTMLCOIN computes address from the public key differently than ethereum, ethereum uses keccak256 while HTMLCOIN uses ripemd160(sha256(compressedPublicKey))
        // @ts-ignore
        defineReadOnly(hdnode, "htmlcoinAddress", computeAddress(hdnode.publicKey, true));
        return new HtmlcoinWallet(hdnode);
    }
}
