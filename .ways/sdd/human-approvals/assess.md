# assess

Goal: Choose the enforcement design.
Evidence: A local approval can never be cryptographically unforgeable against the same OS user, so the design stacks barriers: (1) `ways approve` requires a real TTY on stdin and stdout and a typed confirmation, so tools driving the CLI cannot approve; (2) the artifact is bound to work, phase, gateCommit and the digest of the working diff, so it dies if anything changes; (3) the commit-msg hook refuses human-gate certifications without a valid artifact; (4) the guard blocks tool writes under approvals/ and reviews/. Reviews carry the digest of the diff they reviewed, obtained with `ways review digest`, verified at submit and again at advance.
Decision: Keep SDD; scope fits one work.
Gate: Proceed.
