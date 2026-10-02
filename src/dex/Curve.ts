import { ethers } from 'ethers';
import { AbstractDEX } from './AbstractDEX';
import { NETWORKS } from '../config';

// Minimal ABI for Curve Factory
const FACTORY_ABI = [
  "function get_coin_count(address pool) external view returns (uint256)",
  "function get_coin(address pool, uint256 index) external view returns (address)",
  "function get_token(address pool, uint256 index) external view returns (address)"
];

// Minimal ABI for Curve Pool (simplified for common pool types)
const POOL_ABI = [
  "function get_virtual_price() external view returns (uint256)",
  "function get_balances() external view returns (uint256[])",
  "function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external returns (uint256)",
  "function exchange_underlying(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external returns (uint256)"
];

export class Curve extends AbstractDEX {
  private factory: ethers.Contract;

  constructor(network: keyof typeof NETWORKS) {
    super(network);
    const networkConfig = NETWORKS[network] as Record<string, unknown>;
    this.provider = new ethers.JsonRpcProvider(networkConfig['rpcUrl'] as string);

    // Use Curve factory if available in config
    this.factory = new ethers.Contract(
      (networkConfig['curveFactory'] as string) || ethers.ZeroAddress,
      FACTORY_ABI,
      this.provider
    ) as ethers.Contract;

    // If we have a signer, connect the contracts to it
    if (this.signer) {
      this.factory = this.factory.connect(this.signer) as ethers.Contract;
    }
  }

  // Set signer (if needed later)
  setSigner(signer: ethers.Wallet) {
    this.signer = signer;
    this.factory = this.factory.connect(this.signer) as ethers.Contract;
  }

  // Curve uses different math - getReserves returns token balances
  async getReserves(tokenA: string, tokenB: string): Promise<[bigint, bigint, bigint]> {
    try {
      // Find pool for these tokens
      const poolAddress = await this.findPool(tokenA, tokenB);
      if (poolAddress === ethers.ZeroAddress) {
        throw new Error('Pool not found');
      }

      const pool = new ethers.Contract(poolAddress, POOL_ABI, this.provider);
      const balances = await pool.get_balances();

      // For simplicity, assume tokenA is first coin, tokenB is second
      // In production, we'd need to check the actual token order in the pool
      return [balances[0], balances[1], BigInt(0)];
    } catch (error: unknown) {
      // If error is not an Error instance, create a generic error message
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Unable to get reserves for ${tokenA}/${tokenB}: ${message}`);
    }
  }

  getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    // Curve uses different math - this is a simplification
    // For stablecoin pools with similar values, we can approximate with constant product
    // but with much lower fee
    const fee = 4n; // 0.04% typical Curve fee
    const numerator = amountIn * reserveOut * (1000n - fee);
    const denominator = reserveIn * 1000n + amountIn * fee;
    return numerator / denominator;
  }

  getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    // Curve uses different math - this is a simplification
    const fee = 4n; // 0.04% typical Curve fee
    if (reserveOut <= amountOut) {
      throw new Error('Insufficient reserve');
    }
    const numerator = reserveIn * amountOut * 1000n;
    const denominator = (reserveOut - amountOut) * (1000n - fee);
    return numerator / denominator + 1n;
  }

  async getQuote(amountIn: bigint, tokenIn: string, tokenOut: string): Promise<bigint> {
    try {
      const [reserveIn, reserveOut] = await this.getReserves(tokenIn, tokenOut);
      return this.getAmountOut(amountIn, reserveIn, reserveOut);
    } catch (error: unknown) {
      // Try swapping token order
      try {
        const [reserveOut, reserveIn] = await this.getReserves(tokenOut, tokenIn);
        const amountOut = this.getAmountOut(amountIn, reserveOut, reserveIn);
        return amountOut;
      } catch (reverseError: unknown) {
        // If error is not an Error instance, create a generic error message
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
    // Find pool for these tokens
    const poolAddress = await this.findPool(tokenIn, tokenOut);
    if (poolAddress === ethers.ZeroAddress) {
      throw new Error('Pool not found');
    }

    const pool = new ethers.Contract(poolAddress, POOL_ABI, this.provider);

    // Determine token indices (simplified - assumes tokenIn is index 0, tokenOut is index 1)
    // In production, we'd query the actual token order in the pool
    const tokenInIndex = 0;
    const tokenOutIndex = 1;

    // Call exchange function
    const callData = pool.interface.encodeFunctionData(
      "exchange",
      [
        tokenInIndex,
        tokenOutIndex,
        amountIn,
        amountOutMin
      ]
    );

    return {
      to: poolAddress,
      data: callData,
      value: 0 // Curve pools don't accept ETH directly
    };
  }

  // Find pool for two tokens by checking known pools or factory
  private async findPool(tokenA: string, tokenB: string): Promise<string> {
    // If we have a factory, try to find pool through it
    if ((this.factory as any).address !== ethers.ZeroAddress) {
      try {
        // This is a simplified approach - actual Curve factories are more complex
        // For now, we'll return a placeholder and rely on config
        return ethers.ZeroAddress;
      } catch (error) {
        // Continue to fallback
      }
    }

    // Fallback: return zero address (will cause error in calling functions)
    // In production, we'd maintain a registry of known pools
    return ethers.ZeroAddress;
  }

  async getLiquidityAmount(tokenA: string, tokenB: string, amountA: bigint, amountB: bigint): Promise<bigint> {
    // For Curve, liquidity is related to virtual price and token balances
    // Simplified approximation
    try {
      const [reserveA, reserveB] = await this.getReserves(tokenA, tokenB);
      // Use geometric mean as approximation
      const liquidity = BigInt(Math.floor(Math.sqrt(Number(reserveA) * Number(reserveB))));
      return liquidity;
    } catch (error: unknown) {
      // If error is not an Error instance, we still return the fallback
      return amountA < amountB ? amountA : amountB;
    }
  }

  async computePairAddress(tokenA: string, tokenB: string): Promise<string> {
    // For Curve, we return the pool address
    return await this.findPool(tokenA, tokenB);
  }
}