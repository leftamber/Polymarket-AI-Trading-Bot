"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractDEX = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
class AbstractDEX {
    constructor(network, overrides = {}) {
        this.signer = undefined;
        this.wethAddress = '';
        this.overrides = overrides;
        const networkConfig = config_1.NETWORKS[network];
        const rpc = overrides.rpcUrl || networkConfig.rpcUrl;
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpc);
        if (overrides.weth && /^0x[0-9a-fA-F]{40}$/.test(overrides.weth)) {
            this.wethAddress = overrides.weth;
        }
    }
}
exports.AbstractDEX = AbstractDEX;
