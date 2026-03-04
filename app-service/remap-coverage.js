const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(__dirname, '.nyc_output');
if (!fs.existsSync(outputDir)) {
    console.error("No .nyc_output found.");
    process.exit(1);
}

const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));

files.forEach(file => {
    const filePath = path.join(outputDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remap /app/client/src/ to client/src/
    // Since nyc runs from app-service/, we want the paths to be relative to that or absolute local.
    // The source files are at ../client/src relative to app-service/src/test/ui
    // But they are at ./client/src relative to app-service/
    
    // Convert absolute docker path to absolute local path
    const localSrcPath = path.resolve(__dirname, 'client/src') + '/';
    const remapped = content.replace(/"\/app\/client\/src\//g, `"${localSrcPath}`);
    
    fs.writeFileSync(filePath, remapped);
});

console.log(`Remapped ${files.length} coverage files.`);
