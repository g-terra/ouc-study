---
name: research-topic
description: Deep-dive research on a course topic or project question, producing a cited digest in <sem>/research/<course>/. Use for "research X", "find papers on", "I need sources for my term project", "what does the literature say about".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Research a topic

1. Clarify the goal in one line (understanding / assignment / term project / exam), the course and the depth.
2. Ground it locally: grep `<sem>/text/` for the topic and read the related `<sem>/notes/` and the assignment brief in `<sem>/courses/<course>/`.
3. Delegate to the **researcher** agent. For broad questions, run 2-3 researcher agents in parallel on sub-questions (e.g. "theory", "empirical evidence", "applications/code") and merge the results.
4. Every source needs a working link, verified with WebFetch. No invented citations. Prefer open access.
5. Save to `<sem>/research/<course>/<slug>.md` and reply with a 5-line summary plus the top 3 sources.

Good starting points by course:
- **COS511**: Eysenck & Keane, *Cognitive Psychology: A Student's Handbook*; Reisberg, *Cognition*; Stanford Encyclopedia of Philosophy; Annual Review of Psychology; APA PsycNet; Google Scholar.
- **COS512**: Russell & Norvig AIMA (local PDF); scikit-learn docs; "Attention Is All You Need" (Vaswani 2017); Jay Alammar's illustrated transformer; LangChain/Chroma docs for RAG.
- **COS514**: Dayan & Abbott and Trappenberg (local PDFs); Gerstner et al., *Neuronal Dynamics* (neuronaldynamics.epfl.ch, free online); Neuromatch Academy (compneuro.neuromatch.io); NEURON docs (nrn.readthedocs.io); Hodgkin & Huxley 1952 (local).
