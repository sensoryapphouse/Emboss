---
title: Audit markdown front matter alphafrontmatter
author: Audit Author
---

# Heading one alphah1

## Heading two alphah2

### Heading three alphah3

#### Heading four alphah4

##### Heading five alphah5

###### Heading six alphah6

Setext heading alphasetext
==========================

Setext two alphasetext2
-----------------------

Emphasis: *alphaitalic* _alphaunder_ **alphabold** __alphabold2__ ***alphabi*** ~~alphastrike~~ `alphacode`

Escapes: \*alphaescaped\* and 1\. not a list and a \# hash.

Hard break with two spaces  
second line alphaspaces  
and backslash\
third line alphabackslash

Inline HTML: H<sub>2</sub>O and x<sup>2</sup> and <kbd>alphakbd</kbd> and <mark>alphamark</mark> and <u>alphaunderline</u> and <s>alphahtmlstrike</s> and <br>alphabr

Links: [inline link](https://example.org/alpha "alphatitle") and [reference link][ref1] and <https://example.org/autolink> and https://example.org/bare and [mail](mailto:a@example.org)

[ref1]: https://example.org/ref

Images: ![alphaimgalt](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DwnwEJMGFzAGIhAgQSz9RoAAAAAElFTkSuQmCC "alphaimgtitle") and ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DwnwEJMGFzAGIhAgQSz9RoAAAAAElFTkSuQmCC)

> Block quote alphablockquote
> continues here
>
> > nested quote alphanestedquote

---

```js
function alphafenced() { return 1; }
```

    indented code alphaindented
    second code line

Table of entities: &copy; &amp; &lt; alphaentities

<!-- alphamdcomment -->

<div class="note">HTML block alphahtmlblock</div>

Emoji :smile: and unicode 😀 alphaemoji

A footnote reference[^1] and another[^note].

[^1]: Footnote one text alphafootnote1.
[^note]: Footnote two text alphafootnote2
    with a continuation line.

Term alphadefterm
: Definition alphadefinition
