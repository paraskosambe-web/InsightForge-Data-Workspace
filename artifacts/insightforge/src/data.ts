export const datasets = [
  { name: 'Customer Churn', kind: 'CSV', rows: '7,043', cols: 21, target: 'Churn', status: 'Analyzed', date: 'Today, 10:42 AM', color: 'mint' },
  { name: 'Loan Default', kind: 'XLSX', rows: '12,500', cols: 18, target: 'Default', status: 'Ready', date: 'Yesterday', color: 'blue' },
  { name: 'House Prices', kind: 'CSV', rows: '1,460', cols: 80, target: 'SalePrice', status: 'Analyzed', date: 'Jun 12, 2024', color: 'amber' },
  { name: 'E-Commerce Sales', kind: 'JSON', rows: '24,816', cols: 14, target: 'Revenue', status: 'Ready', date: 'Jun 10, 2024', color: 'violet' },
];
export const profileRows = [
  ['customerID', 'Text', '0.0%', '7,043', 'Categorical', 'Excellent'],
  ['tenure', 'Integer', '0.0%', '73', 'Right-skewed', 'Excellent'],
  ['MonthlyCharges', 'Float', '0.0%', '1,585', 'Normal', 'Excellent'],
  ['TotalCharges', 'Float', '11.0%', '6,536', 'Right-skewed', 'Good'],
  ['Contract', 'Category', '0.0%', '3', 'Categorical', 'Excellent'],
  ['Churn', 'Boolean', '0.0%', '2', 'Imbalanced', 'Good'],
  ['PaymentMethod', 'Category', '0.0%', '4', 'Categorical', 'Excellent'],
];
export const expRows = [
  ['churn-xgb-v4', 'XGBoost', 'Customer Churn', '0.864', 'Completed', 'Jun 18, 2024'],
  ['churn-rf-v3', 'Random Forest', 'Customer Churn', '0.851', 'Completed', 'Jun 17, 2024'],
  ['loan-logreg-v2', 'Logistic Regression', 'Loan Default', '0.792', 'Completed', 'Jun 15, 2024'],
  ['house-gb-v1', 'Gradient Boosting', 'House Prices', '0.827', 'Completed', 'Jun 12, 2024'],
];