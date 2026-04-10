const dns = require('dns');

console.log('Testing default DNS...');
dns.resolve4('google.com', (err, addresses) => {
  if (err) console.error('Default DNS failed on google.com:', err.message);
  else console.log('Default DNS works for google.com:', addresses);
});

console.log('Forcing Custom DNS (8.8.8.8)...');
dns.setServers(['8.8.8.8']);

dns.resolveSrv('_mongodb._tcp.felicmedia2.gojruoc.mongodb.net', (err, records) => {
  if (err) {
    console.error('Custom DNS Resolution Error:', err.message);
  } else {
    console.log('✅ Custom DNS Resolution Successful:', records.length, 'records');
  }
});
