import { ethers } from 'ethers';
import { formatUnits, parseUnits, applySlippage } from '../utils';

describe('utils', () => {
  describe('formatUnits', () => {
    it('should format wei to ether string', () => {
      const value = ethers.parseUnits('1', 18); // 1 ETH in wei
      expect(formatUnits(value, 18)).toBe('1');
    });

    it('should format with different decimals', () => {
      const value = 100n; // 100 wei
      expect(formatUnits(value, 0)).toBe('100');
      expect(formatUnits(value, 2)).toBe('1.00');
    });
  });

  describe('parseUnits', () => {
    it('should parse ether string to wei', () => {
      const value = parseUnits('1', 18);
      expect(value).toBe(ethers.parseUnits('1', 18));
    });

    it('should parse with different decimals', () => {
      expect(parseUnits('1.00', 2)).toBe(100n);
      expect(parseUnits('0.01', 2)).toBe(1n);
    });
  });

  describe('applySlippage', () => {
    it('should apply slippage correctly', () => {
      const amount = ethers.parseUnits('100', 18); // 100 tokens
      const slippage = 0.01; // 1%
      const result = applySlippage(amount, slippage);
      // Expected: amount * (1 - slippage) = 100 * 0.99 = 99 tokens
      expect(result).toBe(ethers.parseUnits('99', 18));
    });

    it('should return zero if slippage is 100%', () => {
      const amount = ethers.parseUnits('50', 18);
      const result = applySlippage(amount, 1.0);
      expect(result).toBe(0n);
    });

    it('should return original amount if slippage is 0%', () => {
      const amount = ethers.parseUnits('75', 18);
      const result = applySlippage(amount, 0.0);
      expect(result).toBe(amount);
    });
  });
});