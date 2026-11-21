// Guard: French text must not be written in the source of the interface. Every visible text of
// src/lib (and src/App.tsx) goes through t() and the catalogues (src/lib/i18n/messages); what
// stays in the code is either a technical value or a proper noun. The scan walks TypeScript/TSX
// ASTs for string literals, template literals, and JSX text nodes (skipping comments and regex
// literals). Every static t('...') key call is also checked against both catalogues. The
// catalogues and generated IPC bindings are not scanned.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/lib/i18n/messages/en';
import { fr } from '../../src/lib/i18n/messages/fr';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const LIB = join(SRC, 'lib');
const APP = join(SRC, 'App.tsx');
const EXCLUDED = [join(LIB, 'i18n'), join(LIB, 'ipc', 'bindings')];
const FRENCH = /[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ’«»]/;

/**
 * Exceptions: a file (relative to src/lib or src/App.tsx), a fragment of the literal text, and
 * the reason. Each one must stay justified (non-user-visible technical value) or be moved to the
 * catalogues.
 */
const ALLOWED: { file: string; text: string; why: string }[] = [
	{
		file: 'features/conversation/links.ts',
		text: ".,;:!?'’",
		why: 'technical punctuation characters stripped from the end of URLs (not user-visible text)'
	}
];

interface Finding {
	file: string;
	line: number;
	text: string;
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (EXCLUDED.some((excluded) => path === excluded || path.startsWith(excluded + '/'))) return [];
		if (entry.isDirectory()) return walk(path);
		return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

function parseFile(file: string, source: string): ts.SourceFile {
	return ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
}

function scanHardcoded(file: string, source: string, base: string): Finding[] {
	const rel = relative(base, file);
	const sf = parseFile(file, source);
	const findings: Finding[] = [];

	const visit = (node: ts.Node) => {
		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node) ||
			ts.isJsxText(node)
		) {
			if (FRENCH.test(node.text)) {
				const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
				findings.push({ file: rel, line, text: node.text.trim().slice(0, 120) });
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sf);
	return findings;
}

function scanMissingKeys(file: string, source: string, base: string): Finding[] {
	const rel = relative(base, file);
	const sf = parseFile(file, source);
	const findings: Finding[] = [];

	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 't' &&
			node.arguments.length >= 1
		) {
			const arg = node.arguments[0];
			if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
				const key = arg.text;
				if (!(key in en) || !(key in fr)) {
					const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
					findings.push({ file: rel, line, text: key });
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sf);
	return findings;
}

describe('no French text is written in the source of src/lib', () => {
	it('finds no hardcoded French outside the catalogues, and no unlisted exception', () => {
		const findings = walk(LIB).flatMap((file) => scanHardcoded(file, readFileSync(file, 'utf8'), LIB));
		const unexpected = findings.filter(
			(f) => !ALLOWED.some((a) => a.file === f.file && f.text.includes(a.text)),
		);
		const report = unexpected.map((f) => `${f.file}:${f.line}  ${f.text}`);
		expect(report).toEqual([]);
	});

	it('finds no hardcoded French in App.tsx', () => {
		const findings = scanHardcoded(APP, readFileSync(APP, 'utf8'), SRC);
		const report = findings.map((f) => `${f.file}:${f.line}  ${f.text}`);
		expect(report).toEqual([]);
	});

	it('checks that every static t() key used in .ts and .tsx sources exists in both catalogues', () => {
		const files = [...walk(LIB), APP];
		const missing = files.flatMap((file) => scanMissingKeys(file, readFileSync(file, 'utf8'), SRC));
		const report = missing.map((f) => `${f.file}:${f.line}  missing i18n key '${f.text}'`);
		expect(report).toEqual([]);
	});
});
