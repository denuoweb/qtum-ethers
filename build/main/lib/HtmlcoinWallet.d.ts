import { Provider, TransactionRequest } from "@ethersproject/abstract-provider";
import { SerializedTransaction } from './helpers/utils';
import { IntermediateWallet } from './helpers/IntermediateWallet';
import { ProgressCallback } from "@ethersproject/json-wallets";
import { Bytes } from "@ethersproject/bytes";
import { Wordlist } from "@ethersproject/wordlists";
export declare const HTMLCOIN_BIP44_PATH = "m/44'/88'/0'/0/0";
export declare const SLIP_BIP44_PATH = "m/44'/172'/0'/0/0";
export declare const defaultPath = "m/44'/172'/0'/0/0";
export declare class HtmlcoinWallet extends IntermediateWallet {
    constructor(privateKey: any, provider?: any);
    protected serializeTransaction(utxos: Array<any>, neededAmount: string, tx: TransactionRequest, transactionType: number): Promise<SerializedTransaction>;
    /**
     * Override to build a raw HTMLCOIN transaction signing UTXO's
     */
    signTransaction(transaction: TransactionRequest): Promise<string>;
    connect(provider: Provider): IntermediateWallet;
    /**
     *  Static methods to create Wallet instances.
     */
    static createRandom(options?: any): IntermediateWallet;
    static fromEncryptedJson(json: string, password: Bytes | string, progressCallback?: ProgressCallback): Promise<IntermediateWallet>;
    static fromEncryptedJsonSync(json: string, password: Bytes | string): IntermediateWallet;
    /**
     * Create a HtmlcoinWallet from a BIP44 mnemonic
     * @param mnemonic
     * @param path HTMLCOIN uses two different derivation paths and recommends SLIP_BIP44_PATH for external wallets, core wallets use HTMLCOIN_BIP44_PATH
     * @param wordlist
     * @returns
     */
    static fromMnemonic(mnemonic: string, path?: string, wordlist?: Wordlist): IntermediateWallet;
}
