import pkg from '../src/generated/prisma/index.js';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

const rows = await prisma.payrollData.findMany({ where: { year: 2026, month: 3 } });
console.log(`Total rows for 2026/3: ${rows.length}`);

let totalWelfare = 0, totalTaxable = 0, totalCommute = 0, totalGross = 0;
const byEmployee = {};
const byStore = {};
for (const r of rows) {
  const ratio = r.ratio / 100;
  const welfare = (r.healthInsuranceCo + r.careInsuranceCo + r.pensionCo +
    r.childContributionCo + r.pensionFundCo + r.employmentInsuranceCo +
    r.workersCompCo + r.generalContributionCo) * ratio;
  totalWelfare += welfare;
  totalTaxable += (r.taxableTotal - r.commuteTaxable) * ratio;
  totalCommute += (r.commuteTaxable + r.commuteNontax) * ratio;
  totalGross += r.grossTotal * ratio;

  byEmployee[r.employeeId] = (byEmployee[r.employeeId] || 0) + 1;
  byStore[r.storeName] = (byStore[r.storeName] || 0) + 1;
}
console.log(`Total welfare: ${Math.round(totalWelfare).toLocaleString()}`);
console.log(`Total taxable: ${Math.round(totalTaxable).toLocaleString()}`);
console.log(`Total commute: ${Math.round(totalCommute).toLocaleString()}`);
console.log(`Total gross: ${Math.round(totalGross).toLocaleString()}`);
console.log();
console.log('Rows per store:');
for (const [s, n] of Object.entries(byStore)) console.log(`  ${s}: ${n}`);
console.log();
const dupes = Object.entries(byEmployee).filter(([_,n]) => n > 1);
console.log(`Employees with multiple rows: ${dupes.length}`);
for (const [emp, n] of dupes) {
  const empRows = rows.filter(r => r.employeeId === emp);
  console.log(`  ${emp} (${empRows[0].employeeName}): ${n} rows`);
  for (const er of empRows) {
    console.log(`    - ${er.storeName} ratio=${er.ratio} health=${er.healthInsuranceCo} pension=${er.pensionCo} gross=${er.grossTotal}`);
  }
}
await prisma.$disconnect();
