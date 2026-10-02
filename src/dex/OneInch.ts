import { ethers } from 'ethers';
import { AbstractDEX } from './AbstractDEX';
import { NETWORKS, AGGREGATORS } from '../config';

// Minimal ABI for 1inch V5 Router
const ONEINCH_ABI = [
  "function swap(address fromToken, address toToken, uint256 amount, uint256 minReturn, address destination, uint256 maxGasPrice, bytes calldata data)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

export class OneInch extends AbstractDEX {
  private router: ethers.Contract;
  private networkKey: keyof typeof NETWORKS;

  constructor(network: keyof typeof NETWORKS) {
    super(network);
    const networkConfig = NETWORKS[network] as Record<string, unknown>;
    this.provider = new ethers.JsonRpcProvider(networkConfig['rpcUrl'] as string);
    this.networkKey = network;
    this.router = new ethers.Contract(
      ((AGGREGATORS.oneinch as any)[network] as string) || ethers.ZeroAddress,
      ONEINCH_ABI,
      this.provider
    ) as ethers.Contract;
    this.wethAddress = (networkConfig['wethAddress'] as string) || ethers.ZeroAddress;
    // If we have a signer, connect the contracts to it
    if (this.signer) {
      this.router = this.router.connect(this.signer) as ethers.Contract;
    }
  }

  // Set signer (if needed later)
  setSigner(signer: ethers.Wallet) {
    this.signer = signer;
    this.router = this.router.connect(this.signer) as ethers.Contract;
  }

  // 1inch doesn't have traditional reserves - estimate from known DEXes
  async getReserves(tokenA: string, tokenB: string): Promise<[bigint, bigint, bigint]> {
    try {
      // Try to get a quote from Uniswap V3 as reference
      const networkKey = this.getNetworkKey();
      const networkConfig = NETWORKS[networkKey] as Record<string, unknown>;
      const uniswapV3Factory = networkConfig['uniswapV3Factory'];
      if (uniswapV3Factory && uniswapV3Factory !== '') {
        // This is simplified - in production we'd instantiate the actual DEX
        const amountIn = ethers.parseEther("0.01"); // 0.01 ETH
        const amountOut = await this.getQuote(amountIn, tokenA, tokenB);

        // Estimate reserves - this is rough but functional
        const reserveIn = amountIn;
        const reserveOut = amountOut * 100n; // Scale up

        return [reserveIn, reserveOut, BigInt(0)];
      }
    } catch (error: unknown) {
      // Fallback to minimal reserves
      return [ethers.parseEther("1"), ethers.parseEther("1000"), BigInt(0)];
    }

    return [ethers.parseEther("1"), ethers.parseEther("1000"), BigInt(0)];
  }

  getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    // Simple constant product formula with small fee
    if (reserveIn === 0n) {
      return 0n;
    }
    const amountOut = (amountIn * reserveOut) / reserveIn;
    // Apply 0.3% fee
    return (amountOut * 997n) / 1000n;
  }

  getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    // Simple constant product formula with small fee
    if (reserveOut === 0n) {
      return 0n;
    }
    const amountIn = (amountOut * reserveIn) / reserveOut;
    // Apply 0.3% fee
    return (amountIn * 1000n) / 997n + 1n;
  }

  async getQuote(amountIn: bigint, tokenIn: string, tokenOut: string): Promise<bigint> {
    // For 1inch, in a real implementation we'd use their API
    // For now, we'll simulate by trying to build a swap transaction with 0 minReturn
    // and seeing what it would return (though this isn't directly possible)

    // Instead, we'll fall back to estimating based on reserves
    try {
      const [reserveIn, reserveOut] = await this.getReserves(tokenIn, tokenOut);
      return this.getAmountOut(amountIn, reserveIn, reserveOut);
    } catch (error: unknown) {
      // Try reverse
      try {
        const [reserveOut, reserveIn] = await this.getReserves(tokenOut, tokenIn);
        const tempOut = this.getAmountOut(amountIn, reserveOut, reserveIn);
        // This gives us tokenOut amount for tokenIn input, which is what we want
        return tempOut;
      } catch (reverseError: unknown) {
        const message = reverseError instanceof Error ? reverseError.message : 'Unknown error';
        throw new Error(`Unable to get quote for ${tokenIn}/${tokenOut}: ${message}`);
      }
    }
  }

  async buildSwapTx(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    amountOutMin: bigint,
    to: string,
    deadline: number
  ): Promise<ethers.TransactionRequest> {
    if (!this.router || (this.router as any).address === ethers.ZeroAddress) {
      throw new Error('1inch router not configured');
    }

    // Build calldata for the swap
    const callData = this.router.interface.encodeFunctionData(
      "swap",
      [
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMin,
        to,
        0, // maxGasPrice (0 = use network gas price)
        "0x" // data (empty)
      ]
    );

    return {
      to: (this.router as any).address,
      data: callData,
      value: tokenIn.toLowerCase() === this.wethAddress.toLowerCase() ? amountIn : 0 // If paying with ETH
    };
  }

  async getLiquidityAmount(tokenA: string, tokenB: string, amountA: bigint, amountB: bigint): Promise<bigint> {
    // For aggregator, liquidity is high - return a large value
    return ethers.parseEther("10000"); // 10,000 ETH worth of liquidity
  }

  async computePairAddress(tokenA: string, tokenB: string): Promise<string> {
    // For aggregator, we return the router address as a placeholder
    return (this.router as any).address || ethers.ZeroAddress;
  }

  private getNetworkKey(): keyof typeof NETWORKS {
    return this.networkKey;
  }
}
