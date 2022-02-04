import { providers } from "ethers";
import {
    ConnectionInfo
  } from "ethers/lib/utils";
import { parseSignedTransaction } from "./helpers/utils";

export class HtmlcoinProvider extends providers.JsonRpcProvider {
  constructor(
    url?: ConnectionInfo | string,
    network?: providers.Networkish
  ) {
    super(url, network);
  }

  /**
   * Override for HTMLCOIN parsing of transaction
   * https://github.com/ethers-io/ethers.js/blob/master/packages/providers/src.ts/base-provider.ts
   */
  async sendTransaction(
    signedTransaction: string | Promise<string>
  ): Promise<providers.TransactionResponse> {
    await this.getNetwork();
    const signedTx = await Promise.resolve(signedTransaction);
    const hexTx = `0x${signedTx}`;
    // Parse the signed transaction here
    const tx = parseSignedTransaction(signedTx);
    try {
      const hash = await this.perform("sendTransaction", {
        signedTransaction: hexTx,
      });
      // Note: need to destructure return result here.
      return this._wrapTransaction(tx, hash);
    } catch (error) {
      error.transaction = tx;
      error.transactionHash = tx.hash;
      throw error;
    }
  }
  /**
   * Function to handle grabbing UTXO's from janus
   * prepareRequest in https://github.com/ethers-io/ethers.js/blob/master/packages/providers/src.ts/json-rpc-provider.ts
   */
  async getUtxos(from?: string, neededAmount?: number) {
    await this.getNetwork();
    const params = [from, neededAmount, "p2pkh"];
    return await this.perform("htmlcoin_qetUTXOs", params);
  }

  /**
   * Override to handle grabbing UTXO's from janus
   * prepareRequest in https://github.com/ethers-io/ethers.js/blob/master/packages/providers/src.ts/json-rpc-provider.ts
   */
  prepareRequest(method: any, params: any): [string, Array<any>] {
    if (method === "htmlcoin_qetUTXOs") {
      return ["htmlcoin_getUTXOs", params];
    }
    return super.prepareRequest(method, params);
  }
}
