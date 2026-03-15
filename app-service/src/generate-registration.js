const { AppServiceRegistration } = require('matrix-appservice-bridge');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const REGISTRATION_PATH = path.resolve(__dirname, '../../synapse/config/app-service-registration.yaml');
// The URL inside the Docker network where Synapse can reach the App Service (Bridge Port)
const URL = 'http://app-service:8008';

const reg = new AppServiceRegistration(URL);
reg.setId(AppServiceRegistration.generateToken());
reg.setHomeserverToken(AppServiceRegistration.generateToken());
reg.setAppServiceToken(AppServiceRegistration.generateToken());
reg.setSenderLocalpart('plural_bot');
reg.addRegexPattern('users', '@_plural_.*', true);
reg.addRegexPattern('aliases', '#_plural_.*', true);

console.log(`Generating registration to ${REGISTRATION_PATH}...`);
fs.writeFileSync(REGISTRATION_PATH, yaml.dump(reg.getOutput()));
console.log('Done!');
