const dns = require('dns');

// Test DNS resolution for MongoDB Atlas cluster
dns.resolveSrv('_mongodb._tcp.Felicmedia.dgfvd2k.mongodb.net', (err, records) => {
  if (err) {
    console.error('DNS Resolution Error:', err);
    return;
  }
  
  if (records && records.length > 0) {
    console.log('✅ DNS Resolution Successful:');
    console.log('Records found:', records.length);
    records.forEach((record, index) => {
      console.log(`Record ${index + 1}:`, record.name, '->', record.address);
    });
  } else {
    console.log('❌ No DNS records found');
  }
});

// Also test basic DNS lookup
dns.resolve4('Felicmedia.dgfvd2k.mongodb.net', (err, addresses) => {
  if (err) {
    console.error('Basic DNS Error:', err);
  } else if (addresses && addresses.length > 0) {
    console.log('✅ Basic DNS Resolution Successful:');
    console.log('IP Addresses:', addresses);
  } else {
    console.log('❌ No IP addresses found');
  }
});
