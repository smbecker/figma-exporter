import * as fs from 'fs';
import * as process from 'process';
import * as yargs from 'yargs';
import { exportFile, exportProject } from './export';

const Liftoff = require('liftoff');
const mypackage = require('../package');

// Set env var for ORIGINAL cwd
// before anything touches it
process.env.INIT_CWD = process.cwd();

const cli = new Liftoff({
	name: mypackage.name,
	configName: mypackage.name,
	extensions: {
		'.json': null
	},
	v8flags: require('v8flags')
});

const logOutputFile = (file: string) => {
	// tslint:disable-next-line:no-console
	console.log(`Figma PDF exported to ${file}.`);
};

const getFormatOptions = argv => {
	return {
		directory: argv.directory,
		format: argv.format,
		scale: argv.scale
	};
};

export function run() {
	cli.launch({}, async env => {
		const configPath = env.configPath;
		if (configPath) {
			yargs.config(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
		}

		yargs
			.env('FIGMA')
			.config()
			.version(mypackage.version)
			.help()
			.usage('Usage: ' + cli.name + ' [command]')
			.options({
				'token': {
					desc: 'The Figma API Access Token',
					type: 'string',
					alias: 'accessToken',
					group: 'Authentication'
				},
				'directory': {
					desc: 'The export directory',
					type: 'string',
					alias: 'dir',
					group: 'Output'
				},
				'format': {
					desc: 'The export format',
					type: 'string',
					group: 'Output'
				},
				'scale': {
					desc: 'The export scale (between 0.1 and 4)',
					type: 'number',
					group: 'Output'
				}
			})
			.command('project <id>', 'Export all files in a project', () => {}, async argv => {
				const outputFiles = await exportProject(argv.id, getFormatOptions(argv), argv.token);
				outputFiles.forEach(logOutputFile);
			})
			.command(['file <key>', '*'], 'Export file', () => {}, async argv => {
				logOutputFile(await exportFile(argv.key, getFormatOptions(argv), argv.token));
			})
			.argv;
	});
}
