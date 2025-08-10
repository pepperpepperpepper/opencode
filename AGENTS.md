## Style

- avoid try catch where possible - prefer to let exceptions bubble up
- avoid else statements where possible
- do not make useless helper functions - inline functionality unless the
  function is reusable or composable
- prefer Bun apis
- do not test code by running it in the background using "&". Instead inform the user that they need to run the code in a separate shell

## Workflow

- you can regenerate the golang sdk by calling ./scripts/stainless.ts
- use virtual environments whenever possible (python, nodejs, etc.)
- design code for virtual environments
- use system package installer when possible
