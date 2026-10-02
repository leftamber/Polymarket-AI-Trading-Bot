"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const utils_1 = require("../utils");
describe('utils', () => {
    describe('formatUnits', () => {
        it('should format wei to ether string', () => {
            const value = ethers_1.ethers.parseUnits('1', 18); // 1 ETH in wei
            expect((0, utils_1.formatUnits)(value, 18)).toBe('1');
        });
        it('should format with different decimals', () => {
            const value = 100n; // 100 wei
            expect((0, utils_1.formatUnits)(value, 0)).toBe('100');
            expect((0, utils_1.formatUnits)(value, 2)).toBe('1.00');
        });
    });
    describe('parseUnits', () => {
        it('should parse ether string to wei', () => {
            const value = (0, utils_1.parseUnits)('1', 18);
            expect(value).toBe(ethers_1.ethers.parseUnits('1', 18));
        });
        it('should parse with different decimals', () => {
            expect((0, utils_1.parseUnits)('1.00', 2)).toBe(100n);
            expect((0, utils_1.parseUnits)('0.01', 2)).toBe(1n);
        });
    });
    describe('applySlippage', () => {
        it('should apply slippage correctly', () => {
            const amount = ethers_1.ethers.parseUnits('100', 18); // 100 tokens
            const slippage = 0.01; // 1%
            const result = (0, utils_1.applySlippage)(amount, slippage);
            // Expected: amount * (1 - slippage) = 100 * 0.99 = 99 tokens
            expect(result).toBe(ethers_1.ethers.parseUnits('99', 18));
        });
        it('should return zero if slippage is 100%', () => {
            const amount = ethers_1.ethers.parseUnits('50', 18);
            const result = (0, utils_1.applySlippage)(amount, 1.0);
            expect(result).toBe(0n);
        });
        it('should return original amount if slippage is 0%', () => {
            const amount = ethers_1.ethers.parseUnits('75', 18);
            const result = (0, utils_1.applySlippage)(amount, 0.0);
            expect(result).toBe(amount);
        });
    });
});
