import {createTheme} from 'thememirror';
import {tags as t} from '@lezer/highlight';
import {drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers} from "@codemirror/view";
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands";
import {bracketMatching, indentOnInput} from "@codemirror/language";
import {pythonLanguage} from "@codemirror/lang-python";
import {javascriptLanguage, tsxLanguage} from "@codemirror/lang-javascript";
import {javaLanguage} from "@codemirror/lang-java";
import {markdownLanguage} from "@codemirror/lang-markdown";
import {cppLanguage} from "@codemirror/lang-cpp";
import {cssLanguage} from "@codemirror/lang-css";
import {htmlLanguage} from "@codemirror/lang-html";
import {jsonLanguage} from "@codemirror/lang-json";
import {phpLanguage} from "@codemirror/lang-php";
import {rustLanguage} from "@codemirror/lang-rust";
import {vueLanguage} from "@codemirror/lang-vue";
import {xmlLanguage} from "@codemirror/lang-xml";
import {yamlLanguage} from "@codemirror/lang-yaml";

export const tomorrow = createTheme({
    variant: 'light',
    settings: {
        background: '#FFFFFF',
        foreground: '#4D4D4C',
        caret: '#AEAFAD',
        selection: '#D6D6D6',
        gutterBackground: '#FFFFFF',
        gutterForeground: '#4D4D4C80',
        lineHighlight: 'rgba(239,239,239,0.5)',
    },
    styles: [
        {
            tag: t.comment,
            color: '#8E908C',
        },
        {
            tag: [t.variableName, t.self, t.propertyName, t.attributeName, t.regexp],
            // color: '#4D4D4C',
            color: '#C82829',
        },
        {
            tag: [t.number, t.bool, t.null],
            color: '#F5871F',
        },
        {
            tag: [t.className, t.typeName, t.definition(t.typeName)],
            color: '#C99E00',
        },
        {
            tag: [t.string, t.special(t.brace)],
            color: '#718C00',
        },
        {
            tag: t.operator,
            color: '#3E999F',
        },
        {
            tag: [t.definition(t.propertyName), t.function(t.variableName)],
            color: '#4271AE',
        },
        {
            tag: t.keyword,
            color: '#8959A8',
        },
        {
            tag: t.derefOperator,
            color: '#4D4D4C',
        },
    ],
});

export const defaultExtensions = [
    keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab
    ]),
    lineNumbers(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    tomorrow
]

export const allColors = [
    '#8959A8',
    '#F5871F',
    '#3E999F',
    '#C82829',
    '#C99E00',
    '#718C00',
    '#C82829',
]

/**
 * @param {string} extension
 */
export function getLanguageByExtension(extension) {
    if (!extension) {
        return pythonLanguage;
    }

    switch (extension) {
        case "py":
            return pythonLanguage;
        case "js":
        case "mjs":
        case "cjs":
            return javascriptLanguage;
        case "java":
            return javaLanguage;
        case "md":
        case "markdown":
            return markdownLanguage;
        case "cpp":
        case "cxx":
        case "cc":
            return cppLanguage;
        case "css":
            return cssLanguage;
        case "html":
        case "htm":
            return htmlLanguage;
        case "json":
        case "jsonc":
            return jsonLanguage;
        case "php":
            return phpLanguage;
        case "rs":
        case "rust":
            return rustLanguage;
        case "tsx":
        case "ts":
            return tsxLanguage;
        case "vue":
            return vueLanguage;
        case "xml":
        case "xsl":
        case "svg":
            return xmlLanguage;
        case "yaml":
        case "yml":
            return yamlLanguage;
        default:
            return pythonLanguage;
    }
}