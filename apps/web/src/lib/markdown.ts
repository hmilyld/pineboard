import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, index, options, env, self);
};

const defaultImage =
  md.renderer.rules.image ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token) {
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
  }
  return defaultImage(tokens, index, options, env, self);
};

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source), {
    ADD_ATTR: ["target", "rel", "loading", "decoding"],
  });
}
