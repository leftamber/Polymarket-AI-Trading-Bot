"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PancakeSwap = void 0;
const ethers_1 = require("ethers");
const AbstractDEX_1 = require("./AbstractDEX");
const config_1 = require("../config");
// Minimal ABI for PancakeSwap V2 Factory (same as Uniswap V2)
const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address pair)"
];
// Minimal ABI for PancakeSwap V2 Router (same as Uniswap V2)
const ROUTER_ABI = [
    "function getReserves(address tokenA, address tokenB) view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function quote(uint amountA, uint reserveA, uint reserveB) pure returns (uint amountB)",
    "function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) pure returns (uint amountOut)",
    "function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) pure returns (uint amountIn)",
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];
const PAIR_ABI = [
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() view returns (address)"
];
class PancakeSwap extends AbstractDEX_1.AbstractDEX {
    constructor(network, overrides = {}) {
        super(network, overrides);
        this.pairCache = new Map();
        const networkConfig = config_1.NETWORKS[network];
        this.wethAddress = overrides.weth || networkConfig['wbnbAddress'] || ethers_1.ethers.ZeroAddress;
        this.factory = new ethers_1.ethers.Contract(overrides.factory || networkConfig['pancakeSwapV2Factory'] || ethers_1.ethers.ZeroAddress, FACTORY_ABI, this.provider);
        this.router = new ethers_1.ethers.Contract(overrides.router || networkConfig['pancakeSwapV2Router'] || ethers_1.ethers.ZeroAddress, ROUTER_ABI, this.provider);
        // If we have a signer, connect the contracts to it
        if (this.signer) {
            this.factory = this.factory.connect(this.signer);
            this.router = this.router.connect(this.signer);
        }
    }
    // Set signer (if needed later)
    setSigner(signer) {
        this.signer = signer;
        this.factory = this.factory.connect(this.signer);
        this.router = this.router.connect(this.signer);
    }
    async getReserves(tokenA, tokenB) {
        const pair = await this.getPairAddressCached(tokenA, tokenB);
        if (!pair || pair === ethers_1.ethers.ZeroAddress) {
            throw new Error(`Pool not found for ${tokenA}/${tokenB}`);
        }
        const pairContract = new ethers_1.ethers.Contract(pair, PAIR_ABI, this.provider);
        const [reserves, token0] = await Promise.all([
            pairContract.getReserves(),
            pairContract.token0(),
        ]);
        const [reserve0, reserve1, blockTimestampLast] = reserves;
        if (String(token0).toLowerCase() === tokenA.toLowerCase()) {
            return [reserve0, reserve1, BigInt(blockTimestampLast)];
        }
        return [reserve1, reserve0, BigInt(blockTimestampLast)];
    }
    async getPairAddressCached(tokenA, tokenB) {
        const key = `${tokenA.toLowerCase()}:${tokenB.toLowerCase()}`;
        const cached = this.pairCache.get(key);
        if (cached !== undefined)
            return cached;
        const pair = await this.factory.getPair(tokenA, tokenB);
        this.pairCache.set(key, pair);
        return pair;
    }
    getAmountOut(amountIn, reserveIn, reserveOut) {
        // PancakeSwap V2 uses same formula as Uniswap V2
        const numerator = amountIn * reserveOut * 997n;
        const denominator = reserveIn * 1000n + amountIn * 997n;
        return numerator / denominator;
    }
    getAmountIn(amountOut, reserveIn, reserveOut) {
        // PancakeSwap V2 uses same formula as Uniswap V2
        const numerator = reserveIn * amountOut * 1000n;
        const denominator = (reserveOut - amountOut) * 997n;
        if (denominator <= 0n) {
            throw new Error('Insufficient reserve');
        }
        return numerator / denominator + 1n;
    }
    async getQuote(amountIn, tokenIn, tokenOut) {
        const [reserveIn, reserveOut] = await this.getReserves(tokenIn, tokenOut);
        return this.getAmountOut(amountIn, reserveIn, reserveOut);
    }
    async buildSwapTx(tokenIn, tokenOut, amountIn, amountOutMin, to, deadline) {
        const path = [tokenIn, tokenOut];
        // Check if tokenIn is ETH (WBNB) or tokenOut is ETH
        const isEthPath = tokenIn.toLowerCase() === this.wethAddress.toLowerCase() ||
            tokenOut.toLowerCase() === this.wethAddress.toLowerCase();
        const callData = this.router.interface.encodeFunctionData("swapExactTokensForTokens", [amountIn, amountOutMin, path, to, deadline]);
        return {
            to: this.router.address,
            data: callData,
            value: isEthPath && tokenOut.toLowerCase() === this.wethAddress.toLowerCase() ? amountIn : 0
        };
    }
    async getLiquidityAmount(tokenA, tokenB, amountA, amountB) {
        // Placeholder - same as Uniswap V2
        return BigInt(0);
    }
    async computePairAddress(tokenA, tokenB) {
        return await this.factory.getPair(tokenA, tokenB);
    }
}
exports.PancakeSwap = PancakeSwap;
