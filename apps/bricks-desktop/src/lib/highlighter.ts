import {
	createHighlighterCore,
	type GrammarState,
	type HighlighterCore,
	type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Add the languages you need. Each one loads the first time it is used.
const languages = {
	bash: () => import("shiki/langs/shellscript.mjs"),
	css: () => import("shiki/langs/css.mjs"),
	diff: () => import("shiki/langs/diff.mjs"),
	html: () => import("shiki/langs/html.mjs"),
	javascript: () => import("shiki/langs/javascript.mjs"),
	json: () => import("shiki/langs/json.mjs"),
	jsx: () => import("shiki/langs/jsx.mjs"),
	markdown: () => import("shiki/langs/markdown.mjs"),
	mermaid: () => import("shiki/langs/mermaid.mjs"),
	python: () => import("shiki/langs/python.mjs"),
	sql: () => import("shiki/langs/sql.mjs"),
	svelte: () => import("shiki/langs/svelte.mjs"),
	tsx: () => import("shiki/langs/tsx.mjs"),
	typescript: () => import("shiki/langs/typescript.mjs"),
	xml: () => import("shiki/langs/xml.mjs"),
	yaml: () => import("shiki/langs/yaml.mjs"),
	"c": () => import("shiki/langs/c.mjs"),
	"cpp": () => import("shiki/langs/cpp.mjs"),
	"csharp": () => import("shiki/langs/csharp.mjs"),
	"go": () => import("shiki/langs/go.mjs"),
	"java": () => import("shiki/langs/java.mjs"),
	"kotlin": () => import("shiki/langs/kotlin.mjs"),
	"lua": () => import("shiki/langs/lua.mjs"),
	"php": () => import("shiki/langs/php.mjs"),
	"ruby": () => import("shiki/langs/ruby.mjs"),
	"rust": () => import("shiki/langs/rust.mjs"),
	"swift": () => import("shiki/langs/swift.mjs"),
	"toml": () => import("shiki/langs/toml.mjs"),
	"ini": () => import("shiki/langs/ini.mjs"),
	"dockerfile": () => import("shiki/langs/dockerfile.mjs"),
	"make": () => import("shiki/langs/make.mjs"),
	"scss": () => import("shiki/langs/scss.mjs"),
	"less": () => import("shiki/langs/less.mjs"),
	"graphql": () => import("shiki/langs/graphql.mjs"),
	"powershell": () => import("shiki/langs/powershell.mjs"),
	"r": () => import("shiki/langs/r.mjs"),
	"dart": () => import("shiki/langs/dart.mjs"),
	"scala": () => import("shiki/langs/scala.mjs"),
	"vue": () => import("shiki/langs/vue.mjs"),
	"perl": () => import("shiki/langs/perl.mjs"),
	"haskell": () => import("shiki/langs/haskell.mjs"),
	"elixir": () => import("shiki/langs/elixir.mjs"),
	"zig": () => import("shiki/langs/zig.mjs"),
	"nix": () => import("shiki/langs/nix.mjs"),
	"objective-c": () => import("shiki/langs/objective-c.mjs"),
	"latex": () => import("shiki/langs/latex.mjs"),
	"proto": () => import("shiki/langs/proto.mjs"),
	"hcl": () => import("shiki/langs/hcl.mjs"),
	"nginx": () => import("shiki/langs/nginx.mjs"),
	"julia": () => import("shiki/langs/julia.mjs"),
	"clojure": () => import("shiki/langs/clojure.mjs"),
	"erlang": () => import("shiki/langs/erlang.mjs"),
	"ocaml": () => import("shiki/langs/ocaml.mjs"),
	"fsharp": () => import("shiki/langs/fsharp.mjs"),
	"bat": () => import("shiki/langs/bat.mjs"),
	"astro": () => import("shiki/langs/astro.mjs"),
	"prisma": () => import("shiki/langs/prisma.mjs"),
	"cmake": () => import("shiki/langs/cmake.mjs"),
	"solidity": () => import("shiki/langs/solidity.mjs"),
};

const aliases: Record<string, keyof typeof languages> = {
	"c++": "cpp",
	"c#": "csharp",
	cs: "csharp",
	cxx: "cpp",
	h: "c",
	hpp: "cpp",
	golang: "go",
	kt: "kotlin",
	rb: "ruby",
	rs: "rust",
	docker: "dockerfile",
	makefile: "make",
	ps1: "powershell",
	pwsh: "powershell",
	objc: "objective-c",
	tex: "latex",
	proto3: "proto",
	tf: "hcl",
	batch: "bat",
	cmd: "bat",
	mjs: "javascript",
	cjs: "javascript",
	htm: "html",
	console: "bash",
	jsonc: "json",
	js: "javascript",
	md: "markdown",
	py: "python",
	sh: "bash",
	svg: "xml",
	shell: "bash",
	shellscript: "bash",
	ts: "typescript",
	yml: "yaml",
	zsh: "bash",
};

let highlighter: Promise<HighlighterCore> | undefined;
/** The highlighter once created: with a loaded language, it highlights synchronously. */
let ready: HighlighterCore | null = null;

function getHighlighter() {
	highlighter ??= createHighlighterCore({
		themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
		langs: [],
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	}).then((core) => (ready = core));

	return highlighter;
}

/** The Shiki language of a name or alias (`ts`, `rs`, `c++`…), or null when it is not listed. */
export function languageId(language: string) {
	return getLanguage(language);
}

/**
 * The tokens of each line, at once, when the highlighter and the language are already loaded;
 * null otherwise (load them with `loadHighlighter`).
 */
export function highlightSync(code: string, language: string): HighlightedLine[] | null {
	const lang = getLanguage(language);
	if (!lang || !ready || (lang !== "ansi" && !ready.getLoadedLanguages().includes(lang))) return null;
	return ready
		.codeToTokens(code, { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
		.tokens.map((line) => toHighlightedLine(line));
}

function getLanguage(language: string) {
	const name = language.toLowerCase();

	if (name === "ansi") {
		return name;
	}

	if (name in languages) {
		return name as keyof typeof languages;
	}

	return aliases[name] ?? null;
}

// One highlighted token. Render it as a `<span>` with this style and class.
export type HighlightedToken = {
	content: string;
	style?: string;
	class?: string;
};

// A line of plain text, or the highlighted tokens of a line.
export type HighlightedLine = string | HighlightedToken[];

function toHighlightedLine(tokens: ThemedToken[]): HighlightedToken[] {
	return tokens.map((token) => ({
		content: token.content,
		style: Object.entries(token.htmlStyle ?? {})
			.map(([property, value]) => `${property}:${value}`)
			.join(";"),
		class: "text-(--shiki-light) dark:text-(--shiki-dark)",
	}));
}

export type Highlighter = NonNullable<Awaited<ReturnType<typeof loadHighlighter>>>;

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string) {
	const lang = getLanguage(language);

	if (!lang) {
		return null;
	}

	const shiki = await getHighlighter();

	if (lang !== "ansi" && !shiki.getLoadedLanguages().includes(lang)) {
		await shiki.loadLanguage(languages[lang]);
	}

	return {
		// Returns the tokens of each line, and the grammar state after the last
		// line. Pass that state back to continue where the code left off.
		highlight(code: string, state?: GrammarState) {
			const tokenize = (text: string) =>
				shiki.codeToTokens(text, {
					lang,
					themes: { light: "github-light", dark: "github-dark" },
					defaultColor: false,
					grammarState: state,
				}).tokens;

			// ANSI has no grammar state, so each line is tokenized on its own and
			// gets the same colors whether it arrives in one piece or streams.
			const tokens =
				lang === "ansi" ? code.split("\n").flatMap((line) => tokenize(line)) : tokenize(code);

			return {
				lines: tokens.map((line) => toHighlightedLine(line)),
				state: shiki.getLastGrammarState(tokens),
			};
		},
	};
}

// Returns the tokens of each line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
	const highlighter = await loadHighlighter(language);

	return highlighter ? highlighter.highlight(code).lines : null;
}
