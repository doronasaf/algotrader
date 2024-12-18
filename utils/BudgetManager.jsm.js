export class BudgetManager {
    constructor(initialBudget) {
        this.totalBudget = initialBudget;
        this.availableBudget = initialBudget;
        this.mutex = new Mutex();
    }

    async allocateBudget(budgetNeededForStock) {
        await this.mutex.lock();
        try {
            if (this.availableBudget >= budgetNeededForStock) {
                this.availableBudget -= budgetNeededForStock;
                return true; // Allocation successful
            }
            return false; // Not enough budget
        } finally {
            this.mutex.unlock();
        }
    }

    async releaseBudget(budgetToRelease) {
        await this.mutex.lock();
        try {
            this.availableBudget += budgetToRelease;
            if (this.availableBudget > this.totalBudget) {
                this.availableBudget = this.totalBudget; // Prevent budget from exceeding total
            }
        } finally {
            this.mutex.unlock();
        }
    }

    async getBudgetInfo() {
        await this.mutex.lock();
        try {
            return {
                totalBudget: this.totalBudget,
                availableBudget: this.availableBudget,
                allocatedBudget: this.totalBudget - this.availableBudget,
            };
        } finally {
            this.mutex.unlock();
        }
    }
}

// Mutex class implementation
class Mutex {
    constructor() {
        this.locked = false;
        this.queue = [];
    }

    async lock() {
        const unlock = () => (this.locked = false);

        if (!this.locked) {
            this.locked = true;
            return unlock;
        }

        return new Promise((resolve) => {
            this.queue.push(() => {
                this.locked = true;
                resolve(unlock);
            });
        });
    }

    unlock() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        } else {
            this.locked = false;
        }
    }
}

// // Usage example
// (async () => {
//     const budgetManager = new BudgetManager(1000);
//
//     // Worker 1 tries to allocate budget
//     const result1 = await budgetManager.allocateBudget(500);
//     console.log("Worker 1 allocation successful:", result1);
//
//     // Worker 2 tries to allocate budget
//     const result2 = await budgetManager.allocateBudget(600);
//     console.log("Worker 2 allocation successful:", result2);
//
//     // Worker 1 releases some budget
//     await budgetManager.releaseBudget(300);
//
//     // Worker 2 tries again
//     const result3 = await budgetManager.allocateBudget(600);
//     console.log("Worker 2 allocation successful after release:", result3);
//
//     // Get budget info
//     const budgetInfo = await budgetManager.getBudgetInfo();
//     console.log("Budget info:", budgetInfo);
// })();
