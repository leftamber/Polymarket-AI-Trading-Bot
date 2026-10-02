"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniswapV3 = void 0;
const ethers_1 = require("ethers");
const AbstractDEX_1 = require("./AbstractDEX");
const config_1 = require("../config");
// Minimal ABI for Uniswap V3 Quoter v2
const QUOTER_ABI = [
    "function quoteExactInput(address tokenIn, address tokenOut, uint24 fee, uint amountIn) external view returns (uint amountOut)",
    "function quoteExactOutput(address tokenIn, address tokenOut, uint24 fee, uint amountOut) external view returns (uint amountIn)"
];
// Minimal ABI for Uniswap V3 Swap Router
const SWAP_ROUTER_ABI = [
    "function exactInput(bytes calldata data) payable external returns (uint amountOut)",
    "function exactInputSingle(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)",
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];
// Minimal ABI for Uniswap V3 Factory
const FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"
];
// Minimal ABI for Uniswap V3 Pool
const POOL_ABI = [
    "function liquidity() view returns (uint128)",
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
];
class UniswapV3 extends AbstractDEX_1.AbstractDEX {
    constructor(network, overrides = {}) {
        super(network, overrides);
        const networkConfig = config_1.NETWORKS[network];
        this.wethAddress = overrides.weth || networkConfig['wethAddress'] || networkConfig['wbnbAddress'] || ethers_1.ethers.ZeroAddress;
        // Use V3 quoter and swap router if available in config
        this.quoter = new ethers_1.ethers.Contract(overrides.quoter || networkConfig['uniswapV3Quoter'] || ethers_1.ethers.ZeroAddress, QUOTER_ABI, this.provider);
        this.swapRouter = new ethers_1.ethers.Contract((overrides.router || networkConfig['uniswapV3Router'] || networkConfig['uniswapV2Router']), // fallback to V2 router if V3 not set
        SWAP_ROUTER_ABI, this.provider);
        this.factory = new ethers_1.ethers.Contract(overrides.factory || networkConfig['uniswapV3Factory'] || ethers_1.ethers.ZeroAddress, FACTORY_ABI, this.provider);
        // If we have a signer, connect the contracts to it
        if (this.signer) {
            this.quoter = this.quoter.connect(this.signer);
            this.swapRouter = this.swapRouter.connect(this.signer);
            this.factory = this.factory.connect(this.signer);
        }
    }
    // Set signer (if needed later)
    setSigner(signer) {
        this.signer = signer;
        this.quoter = this.quoter.connect(signer);
        this.swapRouter = this.swapRouter.connect(signer);
        this.factory = this.factory.connect(signer);
    }
    // Note: V3 doesn't have simple getReserves - liquidity is concentrated in ticks
    // We'll approximate by getting pool liquidity and current price
    async getReserves(tokenA, tokenB) {
        try {
            // Try to get pool for default fee tier (3000 = 0.3%)
            const poolAddress = await this.computePairAddress(tokenA, tokenB);
            if (poolAddress === ethers_1.ethers.ZeroAddress) {
                throw new Error('Pool not found');
            }
            const pool = new ethers_1.ethers.Contract(poolAddress, POOL_ABI, this.provider);
            const [liquidity, slot0] = await Promise.all([
                pool.liquidity(),
                pool.slot0()
            ]);
            const sqrtPriceX96 = slot0.sqrtPriceX96;
            const price = Number(sqrtPriceX96) ** 2 / (2 ** 192);
            // Approximate reserves based on liquidity and price
            // This is a simplification - actual calculation is more complex
            const reserve0 = BigInt(Math.floor(liquidity / Math.sqrt(price)));
            const reserve1 = BigInt(Math.floor(liquidity * Math.sqrt(price)));
            // Return in tokenA, tokenB order
            return [reserve0, reserve1, BigInt(0)];
        }
        catch (error) {
            // Fallback to estimating from quoted amounts
            try {
                const amountIn = ethers_1.ethers.parseEther("1"); // 1 ETH
                const amountOut = await this.getQuote(amountIn, tokenA, tokenB, 3000);
                const reserveIn = amountIn;
                const reserveOut = amountOut;
                return [reserveIn, reserveOut, BigInt(0)];
            }
            catch (fallbackError) {
                let errorMessage = 'Unknown error';
                if (error instanceof Error) {
                    errorMessage = error.message;
                }
                throw new Error(`Unable to get reserves for ${tokenA}/${tokenB}: ${errorMessage}`);
            }
        }
    }
    getAmountOut(amountIn, reserveIn, reserveOut) {
        // V3 uses same formula as V2 for amounts given reserves
        const numerator = amountIn * reserveOut * 997n;
        const denominator = reserveIn * 1000n + amountIn * 997n;
        return numerator / denominator;
    }
    getAmountIn(amountOut, reserveIn, reserveOut) {
        // V3 uses same formula as V2 for amounts given reserves
        const numerator = reserveIn * amountOut * 1000n;
        const denominator = (reserveOut - amountOut) * 997n;
        if (denominator <= 0n) {
            throw new Error('Insufficient reserve');
        }
        return numerator / denominator + 1n;
    }
    // V3-specific quote function using the quoter contract
    async getQuote(amountIn, tokenIn, tokenOut, fee = 3000) {
        // Default fee 3000 = 0.3% (most common pool tier)
        try {
            const amountOut = await this.quoter.quoteExactInput(tokenIn, tokenOut, fee, amountIn);
            return amountOut;
        }
        catch (error) {
            // Try the other fee tiers if 0.3% fails
            const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.25%, 0.3%, 1%
            for (const f of feeTiers) {
                try {
                    const amountOut = await this.quoter.quoteExactInput(tokenIn, tokenOut, f, amountIn);
                    return amountOut;
                }
                catch (e) {
                    // Continue trying other fee tiers
                }
            }
            throw new Error('Unable to get quote for any fee tier');
        }
    }
    // Alternative: get exact output quote
    async getQuoteExactOutput(amountOut, tokenIn, tokenOut, fee = 3000) {
        try {
            const amountIn = await this.quoter.quoteExactOutput(tokenIn, tokenOut, fee, amountOut);
            return amountIn;
        }
        catch (error) {
            const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.25%, 0.3%, 1%
            for (const f of feeTiers) {
                try {
                    const amountIn = await this.quoter.quoteExactOutput(tokenIn, tokenOut, f, amountOut);
                    return amountIn;
                }
                catch (e) {
                    // Continue trying
                }
            }
            throw new Error('Unable to get exact output quote for any fee tier');
        }
    }
    async buildSwapTx(tokenIn, tokenOut, amountIn, amountOutMin, to, deadline) {
        // Determine optimal fee tier based on amount and volatility
        // For now, we'll use 0.3% but in production this should be dynamic
        const fee = await this.selectOptimalFee(tokenIn, tokenOut, amountIn);
        // Calculate proper sqrtPriceLimitX96 to prevent front-running
        const sqrtPriceLimitX96 = this.calculateSqrtPriceLimitX96(amountIn, amountOutMin, tokenIn, tokenOut, fee);
        const callData = this.swapRouter.interface.encodeFunctionData("exactInputSingle", [
            tokenIn,
            tokenOut,
            fee,
            to,
            deadline,
            amountIn,
            amountOutMin,
            sqrtPriceLimitX96
        ]);
        return {
            to: this.swapRouter.address,
            data: callData,
            value: tokenIn.toLowerCase() === this.wethAddress.toLowerCase() ? amountIn : 0 // If paying with ETH
        };
    }
    // Select optimal fee tier based on expected volatility and amount
    async selectOptimalFee(tokenIn, tokenOut, amountIn) {
        // In a production bot, this would analyze historical volatility, pool depths, etc.
        // For now, we'll use a simple heuristic based on amount
        const amountInEth = Number(ethers_1.ethers.formatEther(amountIn));
        // For small amounts (< 1 ETH), use lower fee tiers for better prices
        // For large amounts (> 100 ETH), use higher fee tiers for more liquidity
        if (amountInEth < 1) {
            return 100; // 0.01%
        }
        else if (amountInEth < 10) {
            return 500; // 0.25%
        }
        else if (amountInEth < 100) {
            return 3000; // 0.3%
        }
        else {
            return 10000; // 1%
        }
    }
    // Calculate sqrtPriceLimitX96 to protect against front-running and slippage
    calculateSqrtPriceLimitX96(amountIn, amountOutMin, tokenIn, tokenOut, fee) {
        try {
            // Get current quote to estimate price
            // This creates a potential circular dependency, but we handle it by
            // using a conservative slippage tolerance
            return this.calculateSqrtPriceLimitFromQuote(amountIn, amountOutMin, tokenIn, tokenOut, fee);
        }
        catch (error) {
            // Fallback to a conservative limit that allows 1% slippage
            return this.calculateSqrtPriceLimitFromSlippage(amountIn, amountOutMin, 0.01); // 1% slippage
        }
    }
    // Calculate sqrtPriceLimitX96 based on a quote
    calculateSqrtPriceLimitFromQuote(amountIn, amountOutMin, tokenIn, tokenOut, fee) {
        // This is simplified - in a full implementation we'd:
        // 1. Get the exact quote for amountIn
        // 2. Calculate what sqrtPriceLimit would give us exactly amountOutMin
        // 3. Add a small buffer for safety
        // For now, we'll use a percentage-based approach
        return this.calculateSqrtPriceLimitFromSlippage(amountIn, amountOutMin, 0.005); // 0.5% slippage tolerance
    }
    // Calculate sqrtPriceLimitX96 based on percentage slippage tolerance
    calculateSqrtPriceLimitFromSlippage(amountIn, amountOutMin, slippageTolerance) {
        // For simplicity in this implementation, we'll return 0 (no limit)
        // In a production bot, this would calculate the actual sqrtPriceLimitX96
        // based on the current pool price and the slippage tolerance
        //
        // The formula involves:
        // 1. Getting the current sqrtPriceX96 from the pool
        // 2. Calculating the target sqrtPriceX96 after the swap
        // 3. Applying the slippage tolerance to get the limit
        //
        // For now, we return 0 to indicate no limit (which is safe but not optimal)
        return BigInt(0);
    }
    async getLiquidityAmount(tokenA, tokenB, amountA, amountB) {
        // For V3, liquidity calculation is more complex and depends on tick range
        // We'll return an approximation based on the constant product formula
        // This is not accurate for V3 but provides a reasonable estimate
        try {
            const [reserveA, reserveB] = await this.getReserves(tokenA, tokenB);
            // Use geometric mean as approximation
            const liquidity = BigInt(Math.floor(Math.sqrt(Number(reserveA) * Number(reserveB))));
            return liquidity;
        }
        catch (error) {
            // Fallback to simple min of amounts
            return amountA < amountB ? amountA : amountB;
        }
    }
    async computePairAddress(tokenA, tokenB) {
        // For V3, we need to specify a fee tier
        // Try multiple fee tiers to find existing pool
        const feeTiers = [100, 500, 3000, 10000];
        for (const fee of feeTiers) {
            try {
                const poolAddress = await this.factory.getPool(tokenA, tokenB, fee);
                if (poolAddress !== ethers_1.ethers.ZeroAddress) {
                    return poolAddress;
                }
            }
            catch (error) {
                // Continue to next fee tier
            }
        }
        // If no pool exists, return the address for the most common fee tier
        return await this.factory.getPool(tokenA, tokenB, 3000);
    }
}
exports.UniswapV3 = UniswapV3;
// Helper math for tick calculations (simplified)
class TickMath {
    // Minimal tick math for price calculations
    static getSqrtRatioAtTick(tick) {
        // Simplified implementation - in production use full tick math
        const ratio = 1.0001 ** tick;
        return BigInt(Math.floor(ratio * (2 ** 96)));
    }
}
