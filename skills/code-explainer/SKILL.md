---
name: code-explainer
description: Explain code snippets with syntax highlighting and line-by-line analysis
version: 1.0.0
author: EncoreHub
triggers:
  - "explain this code"
  - "what does this code do"
  - "analyze this function"
  - "@explain"
tools:
  - name: explain_code
    description: Provide a detailed explanation of a code snippet
    parameters:
      code:
        type: string
        description: The code to explain
      language:
        type: string
        description: Programming language (optional, auto-detected)
---

# Code Explainer Skill

Explains code snippets with detailed line-by-line analysis.

## Usage

Paste code and the skill will analyze its structure, explain key patterns, and point out potential issues.
