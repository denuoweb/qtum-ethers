import { encode as encodeVaruint, encodingLength } from 'varuint-bitcoin';
import { encode } from 'bip66';
import { OPS } from "./opcodes";
import { GLOBAL_VARS } from "./global-vars";
import { BufferCursor } from './buffer-cursor';
//@ts-ignore
import { ecdsaSign, sign } from 'secp256k1';
let secp256k1Sign = ecdsaSign
if (!ecdsaSign && sign) {
    // support version 3 secp256k1 library (used by metamask)
    //@ts-ignore
    secp256k1Sign = function(buffer, privateKey) {
        // v3 uses different version of Buffer, fake that these are compatabile
        //@ts-ignore
        buffer._isBuffer = true;
        //@ts-ignore
        privateKey._isBuffer = true;
        return sign(buffer, privateKey);
    }
}
import { encode as encodeCInt, decode as decodeCInt } from "bitcoinjs-lib/src/script_number"
import { sha256, ripemd160 } from "hash.js"
import { BigNumber } from "bignumber.js"
import {
    arrayify,
    BytesLike,
    hexlify
} from "ethers/lib/utils";
import { Transaction } from "@ethersproject/transactions";
import { BigNumber as BigNumberEthers } from "ethers";
import { decode } from "./hex-decoder";
import { computePublicKey } from "@ethersproject/signing-key";
import { TransactionRequest } from "@ethersproject/abstract-provider";

// const toBuffer = require('typedarray-to-buffer')
const bitcoinjs = require("bitcoinjs-lib");

// metamask BigNumber uses a different version so the API doesn't match up
[
    "lessThanOrEqualTo",
    "greaterThan",
    "lessThan",
].forEach((methodName) => {
    // adds is ____ to prototype to reference existing method for api compat
    const is = "is" + methodName.charAt(0).toUpperCase() + methodName.slice(1);
    // @ts-ignore
    if (!BigNumber.prototype[is] && BigNumber.prototype[methodName]) {
        // @ts-ignore
        BigNumber.prototype[is] = BigNumber.prototype[methodName];
    }
})

export interface ListUTXOs {
    address: string,
    txid: string,
    vout: number,
    amount: string,
    safe: boolean,
    spendable: boolean,
    solvable: boolean,
    label: string,
    confirmations: number,
    scriptPubKey: string,
    redeemScript: string
}

export interface TxVinWithNullScriptSig {
    txid: Buffer,
    hash: Buffer,
    vout: number,
    sequence: number,
    script: Buffer,
    scriptSig: null
}

export interface TxVinWithoutNullScriptSig {
    txid: Buffer,
    hash: Buffer,
    vout: number,
    sequence: number,
    script: Buffer,
    scriptSig: Buffer
}
export interface CloneTxVin {
    txid: Buffer,
    hash: Buffer,
    vout: number,
    sequence: number,
    script: Buffer,
    scriptSig: null
}

export interface TxVout {
    script: Buffer,
    value: number,
}

export interface CloneTx {
    version: number,
    locktime: number,
    vins: Array<TxVinWithNullScriptSig | TxVinWithoutNullScriptSig>,
    vouts: Array<TxVout>
}
export interface Tx {
    version: number,
    locktime: number,
    vins: Array<TxVinWithNullScriptSig | TxVinWithoutNullScriptSig>,
    vouts: Array<TxVout>
}

export interface CheckTransactionType {
    transactionType: number,
    neededAmount: any
}

export interface SerializedTransaction {
    serializedTransaction: string,
    networkFee: string
}

function cloneBuffer(buffer: Buffer): Buffer {
    let result = Buffer.alloc(buffer.length);
    buffer.copy(result);
    return result;
}

function cloneTx(tx: any): CloneTx {
    let result = { version: tx.version, locktime: tx.locktime, vins: <any>[], vouts: <any>[] };
    for (let vin of tx.vins) {
        result.vins.push({
            txid: cloneBuffer(vin.txid),
            vout: vin.vout,
            hash: cloneBuffer(vin.hash),
            sequence: vin.sequence,
            script: cloneBuffer(vin.script),
            scriptSig: null
        });
    }
    for (let vout of tx.vouts) {
        result.vouts.push({
            script: cloneBuffer(vout.script),
            value: vout.value,
        });
    }
    return result;
}

// refer to https://en.bitcoin.it/wiki/Transaction#General_format_of_a_Bitcoin_transaction_.28inside_a_block.29
export function calcTxBytes(vins: Array<TxVinWithoutNullScriptSig | TxVinWithNullScriptSig>, vouts: Array<TxVout>): number {
    return 4 + encodingLength(vins.length) +
        vins
            .map(vin => (vin.scriptSig ? vin.scriptSig.byteLength : vin.script.byteLength))
            .reduce((sum, len) => sum + 40 + encodingLength(len) + len, 0) +
        encodingLength(vouts.length) +
        vouts
            .map(vout => vout.script.byteLength)
            .reduce((sum, len) => sum + 8 + encodingLength(len) + len, 0) + 4
}
function calcTxBytesToEstimateFee(vins: Array<TxVinWithoutNullScriptSig | TxVinWithNullScriptSig>, vouts: Array<any>): number {
    return GLOBAL_VARS.TX_EMPTY_SIZE +
        vins.reduce(function (a) { return a + inputBytesToEstimateFee() }, 0) +
        vouts.reduce(function (a, x) { return a + outputBytesToEstimateFee(x) }, 0)
}

// Argument here would be irrelevant considering the assumption that all vins are p2pkh
function inputBytesToEstimateFee(): number {
    return GLOBAL_VARS.TX_INPUT_BASE + GLOBAL_VARS.TX_SCRIPTSIG
}

function outputBytesToEstimateFee(script: Buffer): number {
    return GLOBAL_VARS.TX_OUTPUT_BASE + script.byteLength
}
export function txToBuffer(tx: any): Buffer {
    let neededBytes = calcTxBytes(tx.vins, tx.vouts);
    let buffer = Buffer.alloc(neededBytes);
    let cursor = new BufferCursor(buffer);
    // version
    cursor.writeUInt32LE(tx.version);
    // vin length
    cursor.writeBytes(encodeVaruint(tx.vins.length));
    // vin
    for (let vin of tx.vins) {
        cursor.writeBytes(vin.hash);
        cursor.writeUInt32LE(vin.vout);
        if (vin.scriptSig !== null) {
            cursor.writeBytes(encodeVaruint(vin.scriptSig.length));
            cursor.writeBytes(vin.scriptSig);
        } else {
            cursor.writeBytes(encodeVaruint(vin.script.length));
            cursor.writeBytes(vin.script);
        }
        cursor.writeUInt32LE(vin.sequence);
    }
    // vout length
    cursor.writeBytes(encodeVaruint(tx.vouts.length));
    // vouts
    for (let vout of tx.vouts) {
        cursor.writeUInt64LE(vout.value);
        cursor.writeBytes(encodeVaruint(vout.script.length));
        cursor.writeBytes(vout.script);
    }
    // locktime
    cursor.writeUInt32LE(tx.locktime);
    return buffer;
}

// refer to: https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/src/script_signature.js
function toDER(x: Buffer): Buffer {
    let i = 0;
    while (x[i] === 0) ++i;
    if (i === x.length) return Buffer.alloc(1);
    x = x.slice(i);
    if (x[0] & 0x80) return Buffer.concat([Buffer.alloc(1), x], 1 + x.length);
    return x;
}

// refer to: https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/src/script_signature.js
function encodeSig(signature: Uint8Array, hashType: number): Buffer {
    const hashTypeMod = hashType & ~0x80;
    if (hashTypeMod <= 0 || hashTypeMod >= 4) throw new Error('Invalid hashType ' + hashType);

    const hashTypeBuffer = Buffer.from([hashType]);
    const bufferSignature = Buffer.from(signature);
    const r = toDER(bufferSignature.slice(0, 32));
    const s = toDER(bufferSignature.slice(32, 64));

    return Buffer.concat([encode(r, s), hashTypeBuffer]);
}


/////////////////////////////////////////

export async function signp2pkh(tx: any, vindex: number, privKey: string): Promise<Buffer> {
    return await signp2pkhWith(tx, vindex, (hash: Uint8Array) => {
        return secp256k1Sign(hash, arrayify(privKey));
    });
}

export async function signp2pkhWith(tx: any, vindex: number, signer: Function): Promise<Buffer> {
    let clone = cloneTx(tx);
    // clean up relevant script
    // TODO: Implement proper handling of OP_CODESEPARATOR, this was filtering 'ab' from the script entirely preventing pubkeyhash with ab addresses from generating proper tx
    // Since all scripts are generated locally in this library, temporarily not having this implemented is OK as no scripts will have this opcode
    // let filteredPrevOutScript = clone.vins[vindex].script.filter((op: any) => op !== OPS.OP_CODESEPARATOR);
    // Uint8Array issue here
    // clone.vins[vindex].script = toBuffer(filteredPrevOutScript);
    // zero out scripts of other inputs
    for (let i = 0; i < clone.vins.length; i++) {
        if (i === vindex) continue;
        clone.vins[i].script = Buffer.alloc(0);
    }
    // write to the buffer
    let buffer = txToBuffer(clone)
    // extend and append hash type
    buffer = Buffer.alloc(buffer.byteLength + 4, buffer);
    // append the hash type
    buffer.writeUInt32LE(GLOBAL_VARS.HASH_TYPE, buffer.byteLength - 4);

    // double-sha256
    let firstHash = sha256().update(buffer).digest();
    let secondHash = sha256().update(firstHash).digest();

    // sign on next tick so we don't block UI
    await new Promise((resolve) => setImmediate(resolve));

    // sign hash
    let sig = await signer(new Uint8Array(secondHash));

    // encode sig
    return encodeSig(sig.signature, GLOBAL_VARS.HASH_TYPE);
}
export function p2pkhScriptSig(sig: any, pubkey: any): Buffer {
    return bitcoinjs.script.compile([sig, Buffer.from(pubkey, 'hex')]);
}

// Refer to:
// https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/src/payments/p2pkh.js#L58
export function p2pkhScript(hash160PubKey: Buffer): Buffer {
    return bitcoinjs.script.compile([
        OPS.OP_DUP,
        OPS.OP_HASH160,
        hash160PubKey,
        OPS.OP_EQUALVERIFY,
        OPS.OP_CHECKSIG
    ]);
}

export function contractTxScript(contractAddress: string, gasLimit: number, gasPrice: number, encodedData: string): Buffer {
    // If contractAddress is missing, assume it's a create script, else assume its a call contract interaction
    if (contractAddress === "") {
        return bitcoinjs.script.compile([
            OPS.OP_4,
            encodeCInt(gasLimit),
            encodeCInt(gasPrice),
            Buffer.from(encodedData, "hex"),
            OPS.OP_CREATE,
        ])
    } else {
        return bitcoinjs.script.compile([
            OPS.OP_4,
            encodeCInt(gasLimit),
            encodeCInt(gasPrice),
            Buffer.from(encodedData, "hex"),
            Buffer.from(contractAddress, "hex"),
            OPS.OP_CALL,
        ])
    }
}

function reverse(src: Buffer) {
    let buffer = Buffer.alloc(src.length)
    for (var i = 0, j = src.length - 1; i <= j; ++i, --j) {
        buffer[i] = src[j]
        buffer[j] = src[i]
    }
    return buffer
}

export function generateContractAddress(txid: string) {
    let buffer = Buffer.alloc(32 + 4);
    let cursor = new BufferCursor(buffer);
    cursor.writeBytes(reverse(Buffer.from(txid, "hex")));
    // Assuming vout index is 0 as the transaction is serialized with that assumption.
    cursor.writeUInt32LE(0);
    let firstHash = sha256().update(buffer.toString("hex"), "hex").digest("hex");
    let secondHash = ripemd160().update(firstHash, "hex").digest("hex");
    return secondHash;
}

export function addVins(utxos: Array<ListUTXOs>, neededAmount: string, hash160PubKey: string): (Array<any>) {
    let balance = 0.0;
    let inputs = [];
    let amounts = [];
    for (let i = 0; i < utxos.length; i++) {
        if (utxos[i].safe === undefined || !utxos[i].safe) {
            continue;
        }
        // investigate issue where amount has no decimal point as calculation panics
        let x: any = parseFloat(utxos[i].amount).toFixed(7)
        balance += parseFloat(x);
        inputs.push({ txid: Buffer.from(utxos[i].txid, 'hex'), vout: utxos[i].vout, hash: reverse(Buffer.from(utxos[i].txid, 'hex')), sequence: 0xffffffff, script: p2pkhScript(Buffer.from(hash160PubKey, "hex")), scriptSig: null });
        amounts.push(parseFloat(x));
        if (new BigNumber(neededAmount).isLessThanOrEqualTo(balance)) {
            break;
        }
    }
    return [inputs, amounts];
}

export function addContractVouts(gasPrice: number, gasLimit: number, data: string, address: string, amounts: Array<any>, value: string, hash160PubKey: string, vins: Array<any>): (Array<any> | string) {
    let vouts = [];
    const returnAmount = amounts.reduce((a, b) => a + b);
    const networkFee = new BigNumber(calcTxBytesToEstimateFee(vins, [contractTxScript(address === "" ? "" : address.split("0x")[1], gasLimit, gasPrice, data.split("0x")[1]), p2pkhScript(Buffer.from(hash160PubKey, "hex"))]).toString() + `e-3`).times(0.004).toFixed(7);
    const roundedGasPrice = new BigNumber(new BigNumber(gasPrice + `e-8`).toFixed(7)).toNumber();
    const originalGasPrice = new BigNumber(new BigNumber(gasPrice + `e-8`).toFixed()).toNumber();
    if (roundedGasPrice != originalGasPrice) {
        throw new Error("Precision lost in gasPrice: " + (originalGasPrice - roundedGasPrice))
    }
    const gas = new BigNumber(new BigNumber(gasPrice + `e-8`).toFixed(7)).times(gasLimit).toFixed(7)
    vouts.push({
        script: contractTxScript(address === "" ? "" : address.split("0x")[1], gasLimit, gasPrice, data.split("0x")[1]),
        value: new BigNumber(value).times(1e8).toNumber()
    })
    // if spending amounts === amounts needed for gas/value/network fee, do not add a change vout
    if (new BigNumber(returnAmount).isGreaterThan(new BigNumber(gas).plus(networkFee).plus(value))) {
        vouts.push({
            script: p2pkhScript(Buffer.from(hash160PubKey, "hex")),
            value: new BigNumber(returnAmount).minus(gas).minus(value).minus(networkFee).times(1e8).toNumber()
        });
        return vouts;
    }
    // call htmlcoin_getUTXOs to see if the account has enough to spend with the networkFee and some (for adding more inputs, it costs $$$!) taken into account
    else if (new BigNumber(returnAmount).isLessThan(new BigNumber(gas).plus(networkFee).plus(value))) {
        return new BigNumber(networkFee).plus(0.0019400).toFixed(7)
    }
    else {
        return vouts;
    }
}

export function addp2pkhVouts(hash160Address: string, amounts: Array<any>, value: string, hash160PubKey: string, vins: Array<any>): (Array<any> | string) {
    let vouts = [];
    const returnAmount = amounts.reduce((a, b) => a + b);
    const networkFee = new BigNumber(calcTxBytesToEstimateFee(vins, [p2pkhScript(Buffer.from(hash160Address, "hex")), p2pkhScript(Buffer.from(hash160PubKey, "hex"))]).toString() + `e-3`).times(0.004).toFixed(7);
    vouts.push({
        script: p2pkhScript(Buffer.from(hash160Address, "hex")),
        value: new BigNumber(value).times(1e8).toNumber()
    });
    if (new BigNumber(returnAmount).isGreaterThan(new BigNumber(value).plus(networkFee))) {
        vouts.push({
            script: p2pkhScript(Buffer.from(hash160PubKey, "hex")),
            value: new BigNumber(returnAmount).minus(value).minus(networkFee).times(1e8).toNumber()
        })
        return vouts;
    }
    // call htmlcoin_getUTXOs to see if the account has enough to spend with the networkFee and some (for adding more inputs, it costs $$$!) taken into account
    else if (new BigNumber(returnAmount).isLessThan(new BigNumber(networkFee).plus(networkFee).plus(value))) {
        return new BigNumber(networkFee).plus(0.0019400).toFixed(7)
    }
    else {
        return vouts;
    }
}

export function parseSignedTransaction(transaction: string): Transaction {
    let tx: Transaction = {
        hash: "",
        to: "",
        from: "",
        nonce: 1,
        gasLimit: BigNumberEthers.from("0x3d090"),
        gasPrice: BigNumberEthers.from("0x28"),
        data: "",
        value: BigNumberEthers.from("0x0"),
        chainId: 81,
    };
    // Set hash (double sha256 of raw TX string)
    const sha256HashFirst = sha256().update(transaction, "hex").digest("hex")
    const sha256HashSecond = reverse(Buffer.from(sha256().update(sha256HashFirst, "hex").digest("hex"), "hex")).toString("hex")
    tx['hash'] = `0x${sha256HashSecond}`
    const btcDecodedRawTx = decode(transaction);
    // Check if first OP code is OP_DUP -> assume p2pkh script
    if (bitcoinjs.script.decompile(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].script)[0] === OPS.OP_DUP) {
        tx['to'] = `0x${bitcoinjs.script.decompile(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].script)[2].toString("hex")}`
        // If there is no change output, which is currently being used to identify the sender, how else can we find out the from address?
        tx['from'] = btcDecodedRawTx.outs.length > 1 ? `0x${bitcoinjs.script.decompile(btcDecodedRawTx.outs[1].script)[2].toString("hex")}` : ""
        tx['value'] = BigNumberEthers.from(hexlify(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].value))
    }
    // Check if first OP code is OP_4 and length is > 5 -> assume contract call
    else if (bitcoinjs.script.decompile(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].script)[0] === OPS.OP_4 && bitcoinjs.script.decompile(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].script).length > 5) {
        tx['to'] = `0x${bitcoinjs.script.decompile(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].script)[4].toString("hex")}`
        // If there is no change output, which is currently being used to identify the sender, how else can we find out the from address?
        tx['from'] = btcDecodedRawTx.outs.length > 1 ? `0x${bitcoinjs.script.decompile(btcDecodedRawTx.outs[1].script)[2].toString("hex")}` : ""
        tx['value'] = btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].value > 0 ? BigNumberEthers.from(hexlify(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].value)) : BigNumberEthers.from("0x0")
        tx['data'] = bitcoinjs.script.decompile(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].script)[3].toString("hex")
        tx['value'] = BigNumberEthers.from(hexlify(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].value)).toNumber() === 0 ? BigNumberEthers.from("0x0") : BigNumberEthers.from(hexlify(btcDecodedRawTx.outs[GLOBAL_VARS.UTXO_VINDEX].value))
    }
    // assume contract creation
    else {
        tx['to'] = ""
        // If there is no change output, which is currently being used to identify the sender, how else can we find out the from address?
        tx['from'] = btcDecodedRawTx.outs.length > 1 ? `0x${bitcoinjs.script.decompile(btcDecodedRawTx.outs[1].script)[2].toString("hex")}` : ""
        tx['gasLimit'] = BigNumberEthers.from(hexlify(decodeCInt(bitcoinjs.script.decompile(btcDecodedRawTx.outs[0].script)[1])))
        tx['gasPrice'] = BigNumberEthers.from(hexlify(decodeCInt(bitcoinjs.script.decompile(btcDecodedRawTx.outs[0].script)[2])))
        tx['data'] = bitcoinjs.script.decompile(btcDecodedRawTx.outs[0].script)[3].toString("hex")
    }
    return tx
}

export function computeAddress(key: BytesLike | string, compressed?: boolean): string {
    const publicKey = computePublicKey(key, compressed);
    return computeAddressFromPublicKey(publicKey);
}

export function computeAddressFromPublicKey(publicKey: string): string {
    if (!publicKey.startsWith("0x")) {
        publicKey = "0x" + publicKey;
    }
    const sha256Hash = sha256().update(publicKey.split("0x")[1], "hex").digest("hex")
    const prefixlessAddress = ripemd160().update(sha256Hash, "hex").digest("hex")
    return `0x${prefixlessAddress}`;
}

export function checkTransactionType(tx: TransactionRequest): CheckTransactionType {
    if (!!tx.to === false && (!!tx.value === false || BigNumberEthers.from(tx.value).toNumber() === 0) && !!tx.data === true) {
        const needed = new BigNumber(BigNumberEthers.from(tx.gasPrice).toString() + `e-8`).times(BigNumberEthers.from(tx.gasLimit).toNumber()).toFixed(7).toString()
        return { transactionType: GLOBAL_VARS.CONTRACT_CREATION, neededAmount: needed }
    }
    else if (!!tx.to === false && BigNumberEthers.from(tx.value).toNumber() > 0 && !!tx.data === true) {
        return { transactionType: GLOBAL_VARS.DEPLOY_ERROR, neededAmount: "0" }
    }
    else if (!!tx.to === true && !!tx.data === true) {
        const needed = !!tx.value === true ? new BigNumber(new BigNumber(BigNumberEthers.from(tx.gasPrice).toString() + `e-8`).toFixed(7)).times(BigNumberEthers.from(tx.gasLimit).toNumber()).plus(BigNumberEthers.from(tx.value).toString() + `e-8`).toFixed(7) : new BigNumber(new BigNumber(BigNumberEthers.from(tx.gasPrice).toString() + `e-8`).toFixed(7)).times(BigNumberEthers.from(tx.gasLimit).toNumber()).toFixed(7)
        return { transactionType: GLOBAL_VARS.CONTRACT_CALL, neededAmount: needed }
    }
    else {
        const needed = new BigNumber(BigNumberEthers.from(tx.value).toString() + `e-8`).toFixed(7);
        return { transactionType: GLOBAL_VARS.P2PKH, neededAmount: needed }
    }
}

export async function serializeTransaction(utxos: Array<any>, neededAmount: string, tx: TransactionRequest, transactionType: number, privateKey: string, publicKey: string): Promise<SerializedTransaction> {
    const signer = (hash: Uint8Array) => {
        return secp256k1Sign(hash, arrayify(privateKey));
    };
    return await serializeTransactionWith(utxos, neededAmount, tx, transactionType, signer, publicKey);
}

function dropPrecisionLessThanOneSatoshi(wei: string): string {
    const inWei = BigNumberEthers.from(wei).toNumber();
    const inSatoshiString = new BigNumber(inWei + `e-8`).toFixed(7);
    const inWeiStringDroppedPrecision = new BigNumber(inSatoshiString + `e+8`).toString();
    return inWeiStringDroppedPrecision;
}

export async function serializeTransactionWith(utxos: Array<any>, neededAmount: string, tx: TransactionRequest, transactionType: number, signer: Function, publicKey: string): Promise<SerializedTransaction> {
    // Building the HTMLCOIN tx that will eventually be serialized.
    let htmlcoinTx: Tx = { version: 2, locktime: 0, vins: [], vouts: [] };
    // @ts-ignore
    const [vins, amounts] = addVins(utxos, neededAmount, tx.from.split("0x")[1]);
    // reduce precision in gasPrice to 1 satoshi
    tx.gasPrice = dropPrecisionLessThanOneSatoshi(BigNumberEthers.from(tx.gasPrice).toString());
    htmlcoinTx.vins = vins;
    if (transactionType !== 3) {
        if (transactionType === 2) {
            // @ts-ignore
            let localVouts = addContractVouts(BigNumberEthers.from(tx.gasPrice).toNumber(), BigNumberEthers.from(tx.gasLimit).toNumber(), tx.data, "", amounts, new BigNumber(BigNumberEthers.from("0x0").toNumber() + `e-8`).toFixed(7), tx.from.split("0x")[1], htmlcoinTx.vins);
            if (typeof localVouts === 'string') {
                return { serializedTransaction: "", networkFee: localVouts }
            }
            htmlcoinTx.vouts = localVouts
        }
        else {
            // @ts-ignore
            let localVouts = addContractVouts(BigNumberEthers.from(tx.gasPrice).toNumber(), BigNumberEthers.from(tx.gasLimit).toNumber(), tx.data, tx.to, amounts, !!tx.value === true ? new BigNumber(BigNumberEthers.from(tx.value).toNumber() + `e-8`).toNumber() : new BigNumber(BigNumberEthers.from("0x0").toNumber() + `e-8`).toFixed(7), tx.from.split("0x")[1], htmlcoinTx.vins);
            if (typeof localVouts === 'string') {
                return { serializedTransaction: "", networkFee: localVouts }
            }
            htmlcoinTx.vouts = localVouts
        }
        // Sign necessary vins
        const updatedVins = [];
        for (let i = 0; i < htmlcoinTx.vins.length; i++) {
            updatedVins.push({ ...htmlcoinTx.vins[i], ['scriptSig']: p2pkhScriptSig(await signp2pkhWith(htmlcoinTx, i, signer), publicKey.split("0x")[1]) })
        }
        htmlcoinTx.vins = updatedVins
        // Build the serialized transaction string.
        const serialized = txToBuffer(htmlcoinTx).toString('hex');
        return { serializedTransaction: serialized, networkFee: "" };

    } else {
        // @ts-ignore
        let localVouts = addp2pkhVouts(tx.to.split("0x")[1], amounts, new BigNumber(BigNumberEthers.from(tx.value).toNumber() + `e-8`).toFixed(7), tx.from.split("0x")[1], htmlcoinTx.vins);
        if (typeof localVouts === 'string') {
            return { serializedTransaction: "", networkFee: localVouts }
        }
        else {
            htmlcoinTx.vouts = localVouts
            // Sign necessary vins
            const updatedVins = [];
            for (let i = 0; i < htmlcoinTx.vins.length; i++) {
                updatedVins.push({ ...htmlcoinTx.vins[i], ['scriptSig']: p2pkhScriptSig(await signp2pkhWith(htmlcoinTx, i, signer), publicKey.split("0x")[1]) });
            }
            htmlcoinTx.vins = updatedVins
            // Build the serialized transaction string.
            const serialized = txToBuffer(htmlcoinTx).toString('hex');
            return { serializedTransaction: serialized, networkFee: "" };
        }
    }
}
