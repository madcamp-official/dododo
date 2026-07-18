export interface BinaryMetrics {
  precision: number;
  recall: number;
  f1: number;
}

export function calculateBinaryMetrics(
  truePositive: number,
  falsePositive: number,
  falseNegative: number,
): BinaryMetrics {
  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, truePositive + falseNegative);
  const f1 = divide(2 * precision * recall, precision + recall);
  return { precision, recall, f1 };
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
