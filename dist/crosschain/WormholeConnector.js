"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WormholeConnector = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
// Wormhole Core Bridge ABI (simplified)
const WORMHOLE_ABI = [
    "function postVAAs(bytes[] calldata _vaas) external payable returns (uint64)",
    "function redeem(uint64 _sequence, bytes calldata _vaa) external returns (uint256 amount)",
    "event TransferCompleted(uint64 indexed nonce, address indexed sender, uint16 chain, address senderAddress, uint16 toChain, address toAddress, uint256 amountToken, bytes32 tokenAddress)"
];
class WormholeConnector {
    constructor(network) {
        this.signer = null;
        const networkConfig = config_1.NETWORKS[network];
        this.provider = new ethers_1.ethers.JsonRpcProvider(networkConfig.rpcUrl);
        // Get bridge address for this chain from config, fallback to Ethereum
        const bridgeAddress = config_1.BRIDGES.wormhole[network] || config_1.BRIDGES.wormhole.ethereum;
        this.bridgeContract = new ethers_1.ethers.Contract(bridgeAddress, WORMHOLE_ABI, this.provider);
    }
    setSigner(signer) {
        this.signer = signer;
        if (this.signer) {
            this.bridgeContract = this.bridgeContract.connect(this.signer);
        }
    }
    async postVAAs(vaas) {
        if (!this.signer) {
            throw new Error('Signer not set');
        }
        const tx = await this.bridgeContract.postVAAs(vaas, {
        // Value might be needed for fee on some chains
        });
        const receipt = await tx.wait();
        return receipt.hash;
    }
    async redeem(sequence, vaa) {
        if (!this.signer) {
            throw new Error('Signer not set');
        }
        const tx = await this.bridgeContract.redeem(sequence, vaa);
        const receipt = await tx.wait();
        return receipt.hash;
    }
    async monitorTransfers(callback) {
        const filter = this.bridgeContract.filters.TransferCompleted();
        this.bridgeContract.on(filter, callback);
        // Return a function to remove listener
        return () => {
            this.bridgeContract.off(filter, callback);
        };
    }
}
exports.WormholeConnector = WormholeConnector;
