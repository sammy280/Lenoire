const prisma = require('../config/database'); // <-- adjust to match step 1

async function run() {
  const result = await prisma.order.updateMany({
    where: {
      status: { in: ['PENDING', 'PREPARING', 'READY', 'SERVED'] },
      bill: { status: 'PAID' },
    },
    data: { status: 'COMPLETED' },
  });
  console.log(`Fixed ${result.count} stale orders.`);
  process.exit(0);
}

run();