/**
 * Script to generate the Shattered Prism map JSON file
 * Run with: npx ts-node -r tsconfig-paths/register src/data/maps/generators/generate-shattered-prism.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateShatteredPrism } from './shattered_prism';
import { mapDataToJson } from '../serialization/serialize';

// Generate the map
console.log('Generating Shattered Prism map...');
const mapData = generateShatteredPrism();

// Convert to JSON format
console.log('Converting to JSON format...');
const mapJson = mapDataToJson(mapData);

// Write to file
const outputPath = path.join(__dirname, '../json/shattered_prism.json');
console.log(`Writing to ${outputPath}...`);

fs.writeFileSync(outputPath, JSON.stringify(mapJson, null, 2));

console.log('Done! Map generated successfully.');
console.log(`  Size: ${mapData.width}x${mapData.height}`);
console.log(`  Players: ${mapData.playerCount}`);
console.log(`  Expansions: ${mapData.expansions.length}`);
console.log(`  Watch Towers: ${mapData.watchTowers.length}`);
console.log(`  Ramps: ${mapData.ramps.length}`);
console.log(`  Destructibles: ${mapData.destructibles.length}`);
