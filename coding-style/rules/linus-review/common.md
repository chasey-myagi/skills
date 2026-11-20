# linus-review / common

Language-independent rules for this gate. A language file wins where it names a conflict. Repository policy wins over both.

### CS-ABS-1 · A helper needs a real reason

Introduce a helper, wrapper, or layer only when it already has two call sites, or when the helper names a real concept and makes the main flow readable. Inline a one-off operation. Line count is not the rule.

### CS-ABS-2 · No abstraction before the second implementation

No interface, base class, trait, generic parameter, registry, factory, or plugin system until a second concrete implementation exists. A test double alone is not that second implementation when a function or a concrete fake would do. A public framework whose product is the interface, such as adk-go, may publish the interface with its first implementation.

### CS-ABS-3 · Use what is already there

Do not reimplement the standard library or a dependency the project already imports. A thin wrapper that only renames a library call is noise.

### CS-ABS-4 · Split files by concept

Split a file along a real concept boundary. Merge a tiny file that holds one helper with a single caller. Line count is only a hint, not a limit.

### CS-ABS-5 · No dead code

No unreachable branches, commented-out blocks, "kept for later" stubs, unused exports or parameters added by this change, or TODOs without a ticket.

### CS-AI-1 · Change size matches the task

The diff contains what the task or spec requires. Judge scope against that spec and cite the spec line when the change goes past it. Flag unrequested features, flags, config knobs, compatibility shims, retries, fallbacks, and options for a future that is not specified. Complexity for an unlikely case needs a concrete failure mode and its cost.

### CS-AI-2 · One implementation per behavior

No parallel near-duplicate implementations, copy-pasted blocks that diverge slightly, or a new utility next to an existing one doing the same thing. Extend or reuse the existing code.

### CS-CMT-1 · Comments say why

Comments explain a non-obvious reason or constraint. Do not narrate what the next line already says. Length follows the content. A long-lived workaround names the constraint. A lint suppression names the rule and the reason.

### CS-CMT-2 · No process markers

No process markers in source or docs: priority stamps, review banners, "added for review", a design diary, or a self-report of which rules were followed. A todo names an owner. Process belongs in commits and pull requests.

### CS-CMT-3 · No provenance leakage

Source does not name other repositories, upstream projects, "the closed-source version", prompts or the agent that wrote it. Preserve license notices and concise required attribution.

### CS-NAME-1 · No names that state no role

Do not use a name that states no role: Manager, Service, Helper, Handler, data, info, item, or obj. A value that has a physical unit includes the unit in the name. Abbreviations and short names are decided by the language pack and by repository policy, not by this rule.

### CS-NAME-2 · One value, one name

The same value keeps one name through every function it passes. Do not rename names that are external contracts: wire fields, config keys, checkpoint keys, a callee's parameter names.

### CS-API-1 · No boolean behavior switches

Do not switch behavior with a boolean or a vague option parameter. Write two functions, an enum, or a tagged value. A flag that only forwards to a callee the project already uses can stay.

### CS-AI-3 · Leave unrelated code and comments alone

Do not edit code or comments the task did not ask for. Keep a useful comment a person wrote. A drive-by rename, reformat, or comment deletion is a separate change.

### CS-AI-4 · One public path per item

Export an item from one public path. When you replace an unpublished interface, edit it in place. Do not leave a compatibility shim or the old path behind.

### CS-CMT-4 · Docs describe the result

Comments and docs describe the finished behavior. Do not narrate the design process, write a long essay on why X lost to Y, or attach a report of which rules were followed.

### CS-CMT-5 · Doc comments add what the signature does not

A doc comment does not restate the signature and does not use Parameters or Returns headings. Its text has to match the function it is attached to.

### CS-SMELL-1 · Possible feature envy

A function that mostly reads another module's data might be feature envy. Move it next to that data when the move makes the caller simpler. This is a question, not a block.

### CS-SMELL-2 · Possible data clumps

The same group of values passed together might be a data clump. A named type helps when the group has a meaning. This is a question, not a block.

### CS-SMELL-3 · Possible primitive obsession

A bare string or number that has its own rules might be primitive obsession. A small type helps when mixups are likely. This is a question, not a block.

### CS-SMELL-4 · Possible middle man

A function that only forwards to another function might be a middle man. Call the target when the forwarder adds no name that readers need. This is a question, not a block.

### CS-SMELL-5 · Possible message chains

A long chain of calls that walks through other objects might be a message chain. Ask the object that owns the data when the chain keeps breaking. This is a question, not a block.

### CS-SMELL-6 · Possible shotgun surgery

One behavior change that has to touch many distant sites might be shotgun surgery. Gather that behavior when the next change would do the same walk. This is a question, not a block.
