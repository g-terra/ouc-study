# Visual note format

Notes live in `semesters/<semester>/notes/<COURSE CODE>/<slug>.md`. The app renders them as visual pages.
They are plain Markdown plus a few **visual blocks**, so an AI assistant (or you) can write and edit them easily.

## Front matter (required)

```yaml
---
course: COS514
section: 4            # eClass section index, which links the note to its week
week: 3               # week / lecture number shown on the card
title: Lecture 3 · The Hodgkin-Huxley model
summary: One or two sentences: what this class is about.
source: courses/COS514-Computational-Neuroscience/04-26-September---2-October/COS514_WM-Lecture 3.pdf
tags: action potential, ion channels, ODEs
---
```

## Page structure (use this order)

1. `> [!IDEA] Big idea`: the one-paragraph takeaway.
2. `## Key concepts`: a `cards` block (3–6 cards).
3. `## How it fits together`: a `mermaid` diagram (flow, cycle or concept map).
4. Topic sections: use `compare`, `steps`, `formula` and short Markdown.
5. `## Key terms`: a `terms` block.
6. `## Check yourself`: a `flashcards` block (4–6 cards; hints, not assignment answers).
7. `> [!LINK] Connects to`: links to other weeks and courses.
8. `## Go deeper`: a `links` block.

## Math

LaTeX everywhere: inline `$\tau = RC$`, display `$$ ... $$`. Inside YAML blocks, put LaTeX in **single quotes** or a `|` block,
so backslashes are kept as typed.

## Callouts

```md
> [!IDEA] Optional custom title
> Text with **markdown** and $math$.
```

Kinds: `IDEA` 💡, `KEY` 🔑, `TIP` ✅, `WARN` ⚠️, `EXAM` 🎯, `ANALOGY` 🧠, `LINK` 🔗.

## Visual blocks (fenced, YAML inside)

````md
```cards
- icon: 🧠
  title: Working memory
  text: |
    Holds about **4 chunks** (Cowan).
```

```formula
title: RC membrane
tex: '\tau \frac{dV}{dt} = -(V - V_{rest}) + R I'
where:
  - ['\tau = RC', membrane time constant]
  - ['R', membrane resistance]
note: Exponential approach to the steady state.
```

```compare
title: Feature vs conjunction search
headers: [ "", Feature, Conjunction ]
rows:
  - [ Target defined by, one unique feature, a combination of features ]
  - [ Search, parallel (pop-out), serial ]
```

```steps
title: Synaptic transmission
items:
  - title: Spike arrives
    text: Voltage-gated Ca²⁺ channels open.
  - title: Vesicles release transmitter
```

```terms
- term: Prior
  def: Belief before seeing the data.
```

```flashcards
- q: Why can we drop P(words)?
  a: It's the same for every class.
```

```links
- title: Neuronal Dynamics, ch. 2
  url: https://neuronaldynamics.epfl.ch/online/Ch2.html
  note: Free online textbook chapter.
```

```mermaid
flowchart LR
  A["Stimulus"] --> B["Attention filter"] --> C["Awareness"]
```
````

Mermaid tips: quote every label (`A["text"]`), use `<br/>` for line breaks, keep 4–10 nodes.
