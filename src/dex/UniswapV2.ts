import { ethers } from 'ethers';
import { AbstractDEX, DexOverrides } from './AbstractDEX';
import { NETWORKS } from "../config"

// Minimal ABI for Uniswap V2 Factory
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address pair)"
];

// Minimal ABI for Uniswap V2 Router
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

export class UniswapV2 extends AbstractDEX {
  private pairCache = new Map<string, string>();
  private factory: ethers.Contract;
  private router: ethers.Contract;

  constructor(network: keyof typeof NETWORKS, overrides: DexOverrides = {}) {
    super(network, overrides);
    const networkConfig = NETWORKS[network] as Record<string, unknown>;
    this.wethAddress = overrides.weth || (networkConfig['wethAddress'] as string) || (networkConfig['wbnbAddress'] as string) || ethers.ZeroAddress;
        this.factory = new ethers.Contract(overrides.factory || (networkConfig['uniswapV2Factory'] as string) || ethers.ZeroAddress, FACTORY_ABI, this.provider) as ethers.Contract;
    this.router = new ethers.Contract(overrides.router || (networkConfig['uniswapV2Router'] as string) || ethers.ZeroAddress, ROUTER_ABI, this.provider) as ethers.Contract;
    // If we have a signer, connect the contracts to it
    if (this.signer) {
      this.factory = this.factory.connect(this.signer) as ethers.Contract;
      this.router = this.router.connect(this.signer) as ethers.Contract;
    }
  }

  // Set signer (if needed later)
  setSigner(signer: ethers.Wallet) {
    this.signer = signer;
    this.factory = this.factory.connect(this.signer) as ethers.Contract;
    this.router = this.router.connect(this.signer) as ethers.Contract;
  }

  async getReserves(tokenA: string, tokenB: string): Promise<[bigint, bigint, bigint]> {
    const pair = await this.getPairAddressCached(tokenA, tokenB);
    if (!pair || pair === ethers.ZeroAddress) {
      throw new Error(`Pool not found for ${tokenA}/${tokenB}`);
    }
    const pairContract = new ethers.Contract(pair, PAIR_ABI, this.provider);
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

  private async getPairAddressCached(tokenA: string, tokenB: string): Promise<string> {
    const key = `${tokenA.toLowerCase()}:${tokenB.toLowerCase()}`;
    const cached = this.pairCache.get(key);
    if (cached !== undefined) return cached;
    const pair: string = await this.factory.getPair(tokenA, tokenB);
    this.pairCache.set(key, pair);
    return pair;
  }

  getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    // Uniswap V2 formula: amountOut = (amountIn * reserveOut * 997) / (reserveIn * 1000 + amountIn * 997)
    const numerator = amountIn * reserveOut * 997n;
    const denominator = reserveIn * 1000n + amountIn * 997n;
    return numerator / denominator;
  }

  getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    // Uniswap V2 formula: amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1
    const numerator = reserveIn * amountOut * 1000n;
    const denominator = (reserveOut - amountOut) * 997n;
    if (denominator <= 0n) {
      throw new Error('Insufficient reserve');
    }
    return numerator / denominator + 1n;
  }

  async getQuote(amountIn: bigint, tokenIn: string, tokenOut: string): Promise<bigint> {
    const [reserveIn, reserveOut] = await this.getReserves(tokenIn, tokenOut);
    return this.getAmountOut(amountIn, reserveIn, reserveOut);
  }

  async buildSwapTx(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    amountOutMin: bigint,
    to: string,
    deadline: number
  ): Promise<ethers.TransactionRequest> {
    const path = [tokenIn, tokenOut];
    // Check if tokenIn is ETH (WETH) or tokenOut is ETH
    const isEthPath = tokenIn.toLowerCase() === this.wethAddress.toLowerCase() ||
                      tokenOut.toLowerCase() === this.wethAddress.toLowerCase();

    // We'll use the swapExactTokensForTokens function for simplicity
    // In a real bot, we need to handle ETH vs ERC-20 properly
    const callData = this.router.interface.encodeFunctionData(
      "swapExactTokensForTokens",
      [amountIn, amountOutMin, path, to, deadline]
    );

    return {
      to: (this.router as any).address,
      data: callData,
      value: isEthPath && tokenOut.toLowerCase() === this.wethAddress.toLowerCase() ? amountIn : 0 // If buying ETH with tokens, send ETH value
    };
  }

  async getLiquidityAmount(tokenA: string, tokenB: string, amountA: bigint, amountB: bigint): Promise<bigint> {
    // This is a simplified version; actual liquidity calculation is more complex
    // For Uniswap V2, liquidity tokens represent sqrt(reserve0 * reserve1) minus some constant
    // We'll return a placeholder for now
    return BigInt(0);
  }

  async computePairAddress(tokenA: string, tokenB: string): Promise<string> {
    return await this.factory.getPair(tokenA, tokenB);
  }
}
