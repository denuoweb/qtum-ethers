import { HtmlcoinProvider } from "./HtmlcoinProvider";
export declare class HtmlcoinFunctionProvider extends HtmlcoinProvider {
    readonly fn: Function;
    constructor(fn: Function);
    send(method: string, params: Array<any>): Promise<any>;
}
