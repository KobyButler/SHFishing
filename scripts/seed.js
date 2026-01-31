import { init, setSetting, prepare } from '../src/db.js';

await init();

const services = prepare('SELECT COUNT(*) as count FROM services').get().count;
if (services === 0) {
  const insert = prepare('INSERT INTO services (name, duration_hours, description, price, start_times_json) VALUES (?, ?, ?, ?, ?)');
  insert.run('Sunrise Bass Run', 4, 'Perfect for early risers chasing feeding patterns close to shore.', 450, JSON.stringify(['05:30', '06:30', '07:30']));
  insert.run('Full-Day Trophy Hunt', 6, 'A deep-water adventure targeting trophy fish with advanced gear.', 700, JSON.stringify(['07:00', '08:00']));
}

setSetting('businessName', "Drake's Charters");
setSetting('domain', 'drakescharters.com');
setSetting('phone', '(555) 904-1182');
setSetting('email', 'hello@drakescharters.com');
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
