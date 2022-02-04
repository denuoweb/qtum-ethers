// @ts-nocheck
import { getAddress } from "@ethersproject/address";
import { Provider } from "@ethersproject/abstract-provider";
import { Signer } from "@ethersproject/abstract-signer";
import { arrayify, concat, hexDataSlice, isHexString, joinSignature } from "@ethersproject/bytes";
import { hashMessage, _TypedDataEncoder } from "@ethersproject/hash";
import { defaultPath, HDNode, entropyToMnemonic } from "@ethersproject/hdnode";
import { keccak256 } from "@ethersproject/keccak256";
import { defineReadOnly, resolveProperties } from "@ethersproject/properties";
import { randomBytes } from "@ethersproject/random";
import { SigningKey } from "@ethersproject/signing-key";
import { decryptJsonWallet, decryptJsonWalletSync, encryptKeystore } from "@ethersproject/json-wallets";
import { recoverAddress, serialize } from "@ethersproject/transactions";
import { computeAddress, computeAddressFromPublicKey } from "./utils";
import { computeAddress as computeEthereumAddress } from "@ethersproject/transactions";
import { Logger } from "@ethersproject/logger";
import wif from 'wif';
export const version = "wallet/5.1.0";
const logger = new Logger(version);
function isAccount(value) {
    return (value != null && isHexString(value.privateKey, 32) && value.address != null);
}
function hasMnemonic(value) {
    const mnemonic = value.mnemonic;
    return (mnemonic && mnemonic.phrase);
}
// Created this class due to address being read only and unwriteable from derived classes.
export class IntermediateWallet extends Signer {
    constructor(privateKey, provider) {
        super();
        if (isAccount(privateKey)) {
            const signingKey = new SigningKey(privateKey.privateKey);
            defineReadOnly(this, "_signingKey", () => signingKey);
            defineReadOnly(this, "address", computeAddress(this.publicKey, true));
            if (getAddress(this.address) !== getAddress(privateKey.htmlcoinAddress || privateKey.address)) {
                if (getAddress(computeEthereumAddress(this.publicKey)) === getAddress(privateKey.htmlcoinAddress || privateKey.address)) {
                    logger.throwArgumentError("privateKey/address mismatch: Your address is being generated the ethereum way, please use HTMLCOIN address generation scheme", "privateKey", "[REDACTED]");
                }
                else {
                    logger.throwArgumentError("privateKey/address mismatch", "privateKey", "[REDACTED]");
                }
            }
            if (hasMnemonic(privateKey)) {
                const srcMnemonic = privateKey.mnemonic;
                defineReadOnly(this, "_mnemonic", () => ({
                    phrase: srcMnemonic.phrase,
                    path: srcMnemonic.path || defaultPath,
                    locale: srcMnemonic.locale || "en"
                }));
                const mnemonic = this.mnemonic;
                const node = HDNode.fromMnemonic(mnemonic.phrase, null, mnemonic.locale).derivePath(mnemonic.path);
                if (computeAddress(node.privateKey, true) !== this.address) {
                    logger.throwArgumentError("mnemonic/address mismatch", "privateKey", "[REDACTED]");
                }
            }
            else {
                defineReadOnly(this, "_mnemonic", () => null);
            }
        }
        else {
            if (SigningKey.isSigningKey(privateKey)) {
                /* istanbul ignore if */
                if (privateKey.curve !== "secp256k1") {
                    logger.throwArgumentError("unsupported curve; must be secp256k1", "privateKey", "[REDACTED]");
                }
                defineReadOnly(this, "_signingKey", () => privateKey);
            }
            else {
                // A lot of common tools do not prefix private keys with a 0x (see: #1166)
                if (typeof (privateKey) === "string") {
                    if (privateKey.match(/^[0-9a-f]*$/i) && privateKey.length === 64) {
                        privateKey = "0x" + privateKey;
                    }
                }
                try {
                    if (!privateKey.startsWith("0x")) {
                        let decodedKey = wif.decode(privateKey);
                        privateKey = '0x' + decodedKey.privateKey.toString("hex");
                    }
                }
                catch (e) {
                    // not WIF format
                }
                const signingKey = new SigningKey(privateKey);
                defineReadOnly(this, "_signingKey", () => signingKey);
            }
            defineReadOnly(this, "_mnemonic", () => null);
            defineReadOnly(this, "address", computeAddressFromPublicKey(this.compressedPublicKey));
        }
        /* istanbul ignore if */
        if (provider && !Provider.isProvider(provider)) {
            logger.throwArgumentError("invalid provider", "provider", provider);
        }
        defineReadOnly(this, "provider", provider || null);
    }
    get mnemonic() { return this._mnemonic(); }
    get privateKey() { return this._signingKey().privateKey; }
    get publicKey() { return this._signingKey().publicKey; }
    get compressedPublicKey() { return this._signingKey().compressedPublicKey; }
    getAddress() {
        return Promise.resolve(this.address);
    }
    connect(provider) {
        return new IntermediateWallet(this, provider);
    }
    signTransaction(transaction) {
        return resolveProperties(transaction).then((tx) => {
            if (tx.from != null) {
                if (getAddress(tx.from) !== this.address) {
                    logger.throwArgumentError("transaction from address mismatch", "transaction.from", transaction.from);
                }
                delete tx.from;
            }
            const signature = this._signingKey().signDigest(keccak256(serialize(tx)));
            return serialize(tx, signature);
        });
    }
    async signMessage(message) {
        return joinSignature(this._signingKey().signDigest(hashMessage(message)));
    }
    async _signTypedData(domain, types, value) {
        // Populate any ENS names
        const populated = await _TypedDataEncoder.resolveNames(domain, types, value, (name) => {
            if (this.provider == null) {
                logger.throwError("cannot resolve ENS names without a provider", Logger.errors.UNSUPPORTED_OPERATION, {
                    operation: "resolveName",
                    value: name
                });
            }
            return this.provider.resolveName(name);
        });
        return joinSignature(this._signingKey().signDigest(_TypedDataEncoder.hash(populated.domain, types, populated.value)));
    }
    encrypt(password, options, progressCallback) {
        if (typeof (options) === "function" && !progressCallback) {
            progressCallback = options;
            options = {};
        }
        if (progressCallback && typeof (progressCallback) !== "function") {
            throw new Error("invalid callback");
        }
        if (!options) {
            options = {};
        }
        return encryptKeystore(this, password, options, progressCallback);
    }
    /**
     *  Static methods to create Wallet instances.
     */
    static createRandom(options) {
        let entropy = randomBytes(16);
        if (!options) {
            options = {};
        }
        if (options.extraEntropy) {
            entropy = arrayify(hexDataSlice(keccak256(concat([entropy, options.extraEntropy])), 0, 16));
        }
        const mnemonic = entropyToMnemonic(entropy, options.locale);
        return IntermediateWallet.fromMnemonic(mnemonic, options.path, options.locale);
    }
    static fromEncryptedJson(json, password, progressCallback) {
        return decryptJsonWallet(json, password, progressCallback).then((account) => {
            return new IntermediateWallet(account);
        });
    }
    static fromEncryptedJsonSync(json, password) {
        return new IntermediateWallet(decryptJsonWalletSync(json, password));
    }
    static fromMnemonic(mnemonic, path, wordlist) {
        if (!path) {
            path = defaultPath;
        }
        return new IntermediateWallet(HDNode.fromMnemonic(mnemonic, null, wordlist).derivePath(path));
    }
}
export function verifyMessage(message, signature) {
    return recoverAddress(hashMessage(message), signature);
}
export function verifyTypedData(domain, types, value, signature) {
    return recoverAddress(_TypedDataEncoder.hash(domain, types, value), signature);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSW50ZXJtZWRpYXRlV2FsbGV0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2xpYi9oZWxwZXJzL0ludGVybWVkaWF0ZVdhbGxldC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxjQUFjO0FBQ2QsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLHdCQUF3QixDQUFDO0FBQ3BELE9BQU8sRUFBRSxRQUFRLEVBQXNCLE1BQU0sa0NBQWtDLENBQUM7QUFDaEYsT0FBTyxFQUEwQixNQUFNLEVBQW9ELE1BQU0sZ0NBQWdDLENBQUM7QUFDbEksT0FBTyxFQUFFLFFBQVEsRUFBb0IsTUFBTSxFQUFFLFlBQVksRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFpQixNQUFNLHNCQUFzQixDQUFDO0FBQ25JLE9BQU8sRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUNyRSxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxpQkFBaUIsRUFBWSxNQUFNLHVCQUF1QixDQUFDO0FBQ3pGLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQztBQUNyRCxPQUFPLEVBQUUsY0FBYyxFQUFFLGlCQUFpQixFQUFFLE1BQU0sMkJBQTJCLENBQUM7QUFDOUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLHVCQUF1QixDQUFDO0FBQ3BELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSw0QkFBNEIsQ0FBQztBQUN4RCxPQUFPLEVBQUUsaUJBQWlCLEVBQUUscUJBQXFCLEVBQUUsZUFBZSxFQUFvQixNQUFNLDZCQUE2QixDQUFDO0FBQzFILE9BQU8sRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUF1QixNQUFNLDZCQUE2QixDQUFDO0FBRTdGLE9BQU8sRUFBRSxjQUFjLEVBQUUsMkJBQTJCLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFDcEUsT0FBTyxFQUFFLGNBQWMsSUFBSSxzQkFBc0IsRUFBRSxNQUFNLDZCQUE2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
