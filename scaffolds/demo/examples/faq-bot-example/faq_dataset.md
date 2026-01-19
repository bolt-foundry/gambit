# Gambit FAQ

## What is Gambit?

Gambit is a tool for designing, running, and evaluating AI workflows with decks,
tests, and graders.

## What is a deck?

A deck is a packaged workflow of prompts, tools, and schemas that defines how an
AI task runs.

## What is a grader?

A grader is an evaluation check that scores a turn or conversation against
criteria so you can see what passes and fails.

## What is an action deck?

An action deck is a callable tool that performs a task or fetches data and
returns structured output.

## What is a test deck?

A test deck simulates a user or scenario so you can run repeatable tests against
a deck.

## What is a card?

A card is a reusable content block or data snippet that you can embed in decks.

## What is the Debug UI?

The Debug UI is the web app for chatting with a deck, viewing traces, and
running graders.

## How do I run a deck locally?

Use the Gambit CLI to run a deck from the command line.

## What modules ship in Gambit?

- Deck editor for building root/action/test decks.
- Debug UI for running conversations and inspecting traces.
- Test bot panel for scripted personas and graders.
- Coverage dashboard for reviewing grader outcomes.
- Bundle/export tooling to package decks for deployment.
