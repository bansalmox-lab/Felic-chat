// MongoDB Atlas Cluster Reactivation Steps

// If your cluster is inactive/paused, follow these steps:

/*
1. Log into MongoDB Atlas: https://cloud.mongodb.com/
2. Go to "Clusters" section
3. Find your cluster "Felicmedia"
4. Click the "..." menu on your cluster
5. Select "Resume" or "Activate"
6. Wait 2-3 minutes for cluster to start
7. Verify cluster status shows "Active" (green)

// Alternative: Create New Cluster
/*
1. In MongoDB Atlas, click "Build a Cluster"
2. Choose "M0 Sandbox" (free tier)
3. Select cloud provider and region closest to you
4. Give it a name (e.g., "Felicmedia")
5. Click "Create Cluster"
6. Wait for deployment (2-5 minutes)
7. Update connection string in .env file

// After Activation:
/*
- Your current connection string should work
- DNS resolution will succeed
- App will automatically switch to MongoDB storage
- Messages will persist across server restarts
*/

console.log("MongoDB Atlas cluster is currently inactive.");
console.log("Please log into MongoDB Atlas and reactivate your cluster.");
console.log("Once active, restart this server to test connection.");
