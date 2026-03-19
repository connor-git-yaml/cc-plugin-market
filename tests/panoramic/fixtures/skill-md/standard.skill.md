---
name: code-review
description: Automated code review skill
version: 1.2.0
---

# Code Review Skill

This skill performs automated code reviews on pull requests.

## Commands

- `/review` - Start a code review
- `/approve` - Approve the current PR

## Workflow

1. Developer opens a PR
2. Skill analyzes the diff
3. Generates review comments

## Constraints

- Maximum file size: 1MB
- Only supports TypeScript and JavaScript
