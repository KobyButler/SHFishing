import { init, setSetting, prepare } from '../src/db.js';

await init();

const services = prepare('SELECT COUNT(*) as count FROM services').get().count;
if (services === 0) {
  const insert = prepare('INSERT INTO services (name, duration_hours, description, price, start_times_json) VALUES (?, ?, ?, ?, ?)');
  insert.run('Full day', 8, 'Full-day guided trip for anglers looking to maximize time on the water.', 500, JSON.stringify(['06:00', '07:00']));
  insert.run('Half day', 5, 'Shorter guided trip with the same focused coaching and local expertise.', 350, JSON.stringify(['06:00', '12:00']));
  insert.run('Custom kids trip', 0, 'Kid-focused custom trip. Contact us for timing, length, and details.', 0, JSON.stringify(['08:00']));
}

setSetting('businessName', 'S&H Fishing');
setSetting('domain', 'shfishing.com');
setSetting('phone', '435-749-9980');
setSetting('email', 'hello@shfishing.com');
setSetting('facebook', 'https://facebook.com');
setSetting('instagram', 'https://instagram.com');
setSetting('address', 'Lakeview Marina, North Cove');
setSetting('licenseUrl', 'https://example.com/fishing-license');
setSetting('policyEffectiveDate', 'January 30, 2026');
setSetting('waiverEffectiveDate', 'January 30, 2026');
setSetting('paymentsEnabled', 'false');
setSetting('analyticsEnabled', 'false');

if (!prepare('SELECT 1 FROM settings WHERE key = ?').get('lodgingList')) {
  setSetting('lodgingList', JSON.stringify([
    { name: 'Harborview Lodge', description: 'Rustic rooms with sunrise views and walking access to the marina.', url: 'https://example.com' },
    { name: 'Cedar Creek Cabins', description: 'Family-friendly cabins with full kitchens and lakefront fire pits.', url: 'https://example.com' }
  ]));
}

if (!prepare('SELECT 1 FROM settings WHERE key = ?').get('foodList')) {
  setSetting('foodList', JSON.stringify([
    { name: 'Dockside Grill', description: 'Fresh sandwiches, chowder, and hot coffee at the boat ramp.', url: 'https://example.com' },
    { name: 'The Driftwood Diner', description: 'Comfort food with local pies and quick takeout options.', url: 'https://example.com' }
  ]));
}

if (!prepare('SELECT 1 FROM settings WHERE key = ?').get('campingList')) {
  setSetting('campingList', JSON.stringify([
    'North Ridge Pullout (2 miles past the marina)',
    'Pine Flats BLM Road 14 turnout',
    'Bluewater Shoreline primitive sites'
  ]));
}

console.log('Seed complete.');
