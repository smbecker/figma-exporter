// borrows heavily from https://github.com/gweltaz-calori/Figma-To-Pdf/blob/master/utils/index.js

import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import * as request from 'request';
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

const sortFrames = pages => {
	let lines = [];
	const sortedByHeight = pages.sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y);

	// tslint:disable-next-line:forin
	for (let page in sortedByHeight) {
		const pageItem = sortedByHeight[page];
		const nextPageItem = sortedByHeight[parseInt(page, 10) + 1];
		if (nextPageItem) {
			const midPoint = pageItem.absoluteBoundingBox.height / 2;

			if (Math.abs(nextPageItem.absoluteBoundingBox.y - pageItem.absoluteBoundingBox.y) <= midPoint) {
				if (lines.length === 0) {
					lines.push(pageItem);
				}
				lines.push(nextPageItem);
			} else {
				if (lines.length > 0) {
					const  index = sortedByHeight.findIndex((el) => el.id === lines[0].id);
					const sortedLine = lines.sort((a, b) => a.absoluteBoundingBox.x - b.absoluteBoundingBox.x);
					sortedByHeight.splice(index, sortedLine.length);
					sortedByHeight.splice(index, 0, ...sortedLine);
					lines = [];
				}
			}
		}
	}

	return sortedByHeight;
};

type FileDetails = {
	key: string;
	name: string;
	pages?: any[];
};

type ExportOptions = {
	directory?: string;
	format?: string;
	scale?: number;
};

const get = (url: string, token: string): Promise<any> => {
	return new Promise<any>((resolve, reject) => {
		request({
			url,
			method: 'GET',
			headers: {
				'Accept': 'application/json',
				'X-Figma-Token': token
			},
			json: true
		}, (err, response, body) => {
			if (!err && response.statusCode !== 200) {
				err = new Error(`The request was not successful: ${url} [${response.statusCode}: ${JSON.stringify(body)}]`);
			}
			if (err) {
				return reject(err);
			}

			resolve(body);
		});
	});
};

const getProjectDetails = async (key: string, token: string): Promise<FileDetails[]> => {
	const body = await get(`https://api.figma.com/v1/projects/${key}/files`, token);
	return body.files;
};

const getFileDetails = async (key: string, token: string): Promise<FileDetails> => {
	const body = await get(`https://api.figma.com/v1/files/${key}`, token);
	const pages = sortFrames(body.document.children[0].children.filter(layer => layer.type === 'FRAME'));
	return {
		key,
		name: body.name,
		pages
	};
};

const exportPages = async (file: FileDetails, format: string, scale: number, token: string): Promise<void> => {
	const ids = file.pages.map(page => page.id).join(',');
	const body = await get(`https://api.figma.com/v1/images/${file.key}?ids=${ids}&format=${format}${(scale && scale > 0 ? `&scale=${scale}` : '')}`, token);

	for (let page of file.pages) {
		page.imageUrl = body.images[page.id];
	}
};

const getExportSvgContent = async (page: any, token: string): Promise<void> => {
	page.svgContent = await get(page.imageUrl, token);
};

const getExportSvgContents = async (file: FileDetails, token: string): Promise<void> => {
	const imagesPromises = file.pages.map(page => getExportSvgContent(page, token));
	await Promise.all(imagesPromises);
};

const createPdf = (file: FileDetails, res: any) => {
	const options = {
		assumePt: true
	};

	const pages = file.pages.slice(0);

	const doc = new PDFDocument({
		compress: false,
		size: [pages[0].absoluteBoundingBox.width, pages[0].absoluteBoundingBox.height]
	});

	doc.pipe(res);

	pages.forEach((page, index) => {
		if (index !== 0) {
			doc.addPage({ size: [page.absoluteBoundingBox.width, page.absoluteBoundingBox.height] });
		}
		SVGtoPDF(doc, page.svgContent, 0, 0, options);
	});

	doc.end();
};

const exportPdf = async (file: FileDetails, output: string, scale: number, token: string) => {
	await exportPages(file, 'svg', scale, token);
	await getExportSvgContents(file, token);

	const stream = fs.createWriteStream(output);
	createPdf(file, stream);
};

const exportPngPage = async (directory: string, name: string, pageNumber: number, imageUrl: string, token: string): Promise<void> => {
	return new Promise<any>(resolve => {
		request({
			uri: imageUrl,
			method: 'GET',
			headers: {
				'Accept': 'image/png',
				'X-Figma-Token': token
			}
		})
		.pipe(fs.createWriteStream(path.join(directory, `${name}-${pageNumber}.png`)))
		.on('close', resolve);
	});
};

const exportPng = async (file: FileDetails, output: string, scale: number, token: string) => {
	await exportPages(file, 'png', scale, token);

	const directory = path.dirname(output);
	const baseName = path.basename(output, '.png');

	const pagePromises = file.pages.map((page, index) => exportPngPage(directory, baseName, index + 1, page.imageUrl, token));
	await Promise.all(pagePromises);
};

const exportFormats = {
	'pdf': exportPdf,
	'png': exportPng,
	// 'svg': exportSvg
};

export const exportFile = async (key: string, options: ExportOptions, token: string): Promise<string> => {
	const directory = options && options.directory || process.cwd();
	const format = options && options.format || 'pdf';

	const formatter = exportFormats[format];
	if (!formatter) {
		throw new Error(`The requested format is invalid: ${format}`);
	}

	const details = await getFileDetails(key, token);
	const name = `${details.name}.${format}`;
	const file = path.join(directory, name);

	if (details.pages && details.pages.length > 0) {
		await formatter(details, file, options && options.scale, token);
	}

	return file;
};

export const exportProject = async (key: string, options: ExportOptions, token: string): Promise<string[]> => {
	const files = await getProjectDetails(key, token);
	const filePromises = files.map(file => exportFile(file.key, options, token));

	return await Promise.all(filePromises);
};
