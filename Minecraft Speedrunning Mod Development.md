# **Serverless Peer-to-Peer Matchmaking Architecture for Minecraft Speedrunning**

## **Architectural Paradigm and System Overview**

The engineering of a decentralized, peer-to-peer matchmaking system for Minecraft Speedrunning (MCSR) introduces a highly complex set of architectural challenges, particularly when bypassing traditional centralized server topologies. The conventional approach to multiplayer Minecraft relies on a heavy, persistent backend server, typically a modified Spigot, Paper, or Fabric dedicated server instance. This centralized authority maintains the definitive state of the game world, arbitrates all entity interactions, and synchronizes chunk data across connected clients. However, in a serverless 1v1 matchmaking environment tailored specifically for offline or cracked accounts, this architectural paradigm must undergo a fundamental shift. The client modifications themselves must assume authoritative control over local world generation while relying entirely on an external, ultra-lightweight state-synchronization layer to maintain competitive parity with the opponent.

To achieve this precise orchestration, the proposed architecture leverages the Fabric API as the primary mod loading framework, coupled tightly with SpongePowered Mixins for invasive, runtime bytecode manipulation.1 Instead of a custom Java backend processing persistent socket connections, a cloud database—specifically Firebase Realtime Database (RTDB) or Supabase—operates merely as a passive "bulletin board" state machine.3 The client mods communicate by sending standard HTTP Representational State Transfer (REST) requests to this database to sync critical game states.4 Modifying the Minecraft client to act concurrently as the game engine, the local server host, and the matchmaking arbitrator requires a delicate orchestration of asynchronous network threads, deterministic world generation hooks, and precise rendering pipeline interruptions.

The decision to utilize REST API calls over proprietary SDKs is driven by the absolute necessity to maintain a minimal client footprint, preventing dependency conflicts within the heavily abstracted Minecraft environment. The official Firebase Admin SDKs and client libraries are notoriously heavy, bundling dependencies such as gRPC, Netty, and Guava, which frequently conflict with Minecraft's internal libraries or the Fabric Loader itself.3 Furthermore, many robust Java HTTP clients introduce unnecessary bloat for what is essentially simple string and JSON synchronization.7 To maintain this lightweight footprint, the architecture relies on standard HTTP REST requests constructed using lightweight wrappers such as HTTP4J or the native java.net.http.HttpClient introduced in Java 11\.7

The native Java HttpClient is particularly advantageous in this modding context because it supports HTTP/2, connection pooling, and fully asynchronous, non-blocking requests natively without pulling in external JARs.9 In the context of a Minecraft mod, executing synchronous network requests on the main client thread will instantly cause the game loop to halt, leading to Watchdog crashes, server disconnects, or severe rendering stutters. By utilizing CompletableFuture chains with the native asynchronous HTTP client, the Fabric mod can poll the Firebase REST API endpoints silently in the background.10 The game state is updated only when these futures resolve, pushing their JSON payloads back to the main Minecraft thread via a thread-safe execution queue.

## **Bytecode Manipulation and the Fabric Ecosystem**

The foundation of this peer-to-peer framework relies on the capacity to seamlessly alter the hardcoded behaviors of the vanilla Minecraft client. This is achieved through SpongePowered Mixins, a complex subsystem integrated into the Fabric ecosystem that transforms the compiled Java bytecode of targeted classes at runtime, prior to the class being loaded by the Java Virtual Machine (JVM).1 Developing with Mixins requires an intimate understanding of Java bytecode, as the developer is injecting instructions directly into the control flow of the game engine rather than utilizing standard Application Programming Interfaces (APIs) or event listeners.1

While the Fabric API does provide a robust event system—such as ClientPlayConnectionEvents or AttackBlockCallback—that allows mods to react to occurrences without direct bytecode manipulation 2, the highly specific requirements of a serverless matchmaking protocol necessitate deeper access. Standard events substitute the use of Mixins for common use cases to ensure compatibility between disparate mods.2 However, intercepting the exact millisecond of the Ender Dragon's death sequence or overriding the main menu's world generation pipeline requires targeted @Inject, @Redirect, or @ModifyVariable annotations placed strategically within vanilla methods.11

When a Mixin is compiled, the Fabric Loader reads the fabric.mod.json metadata file to locate the designated mixins.json configuration.12 This configuration file dictates which Mixin classes are applied to the physical client and server environments.13 The annotations parsed from these classes define the injection points. For example, an @Inject annotation targeting the HEAD of a method will insert the custom logic immediately before the first instruction of the original method, allowing the mod to read parameters or cancel the method's execution entirely via CallbackInfo.cancel().11 This level of control is what enables the matchmaking mod to hijack the standard Minecraft flow and enforce competitive speedrunning conditions.

## **State Synchronization and Database Schema Design**

The Firebase Realtime Database operates as a hierarchical, NoSQL JSON tree. Because this cloud database lacks internal matchmaking logic or server-side arbitration algorithms, the Minecraft clients themselves must act as the orchestrators of the state machine. They accomplish this distributed orchestration by performing atomic operations and conditional updates via REST API calls. The REST protocol allows direct manipulation of the JSON tree by appending .json to the target path and issuing standard HTTP methods.4

The synchronization of the matchmaking state relies on a strict schema designed explicitly for atomicity and the prevention of race conditions. The data structure is divided into three primary operational nodes, each serving a distinct phase of the matchmaking lifecycle.

| Node Path | HTTP Method | Payload Example | Purpose and Lifecycle Context |
| :---- | :---- | :---- | :---- |
| /queue/{lobby\_id} | PUT | {"host": "PlayerA", "seed": "12345", "status": "waiting"} | Created by the first player initiating a search. This node acts as the broadcast beacon and is removed once a second player joins. |
| /queue/{lobby\_id} | PATCH | {"status": "accepted", "guest": "PlayerB"} | Issued by the searching player to claim the lobby atomically. Utilizing PATCH avoids race conditions if multiple players query the same lobby. |
| /live\_matches/{match\_id} | PUT | {"seed": "12345", "player\_a": {"status": "loaded"}, "player\_b": {"status": "loading"}} | The persistent state object instantiated upon successful matchmaking. Used throughout the speedrun for bidirectional telemetry. |
| /live\_matches/{match\_id}/player\_b | PATCH | {"status": "loaded"} | Partial updates used by the client to report their loading completion without inadvertently overwriting the opponent's concurrent state update.16 |
| /history/{match\_id} | PUT | {"winner": "PlayerA", "winning\_time": "25:42", "loser": "PlayerB"} | Immutable record created upon match termination, formatted specifically for future web dashboard consumption and persistent leaderboard generation. |

### **Resolving Race Conditions with HTTP PATCH**

When two players attempt to join the same open lobby simultaneously, network race conditions are inevitable. If the system relies exclusively on HTTP PUT requests, a scenario occurs where Player B overwrites the entire /queue/{lobby\_id} node to claim the match, only for Player C's delayed PUT request to arrive milliseconds later, overwriting Player B's claim and corrupting the match state.5

To mitigate this, the client logic must utilize the PATCH HTTP method combined with strict validation. A PATCH request allows a client to update specific child keys at a location without deleting or replacing the omitted sibling keys.16 If Player B issues a PATCH to update the status to accepted, the client logic must verify the HTTP response to ensure they successfully acquired the guest slot before proceeding to local world generation.

For continuous telemetry and status updates during the active match, PATCH requests are equally mandatory. If Player A updates their status to loaded using a PUT request at the root of the match object, they risk entirely erasing Player B's concurrent state update.5 By heavily utilizing isolated PATCH endpoints directed at specific child nodes (e.g., PATCH /live\_matches/12345/player\_a.json), the architecture guarantees that high-frequency asynchronous state reports never collide.

## **Matchmaking and World Generation Subjugation**

Once a match is successfully negotiated in the Firebase database, the mod must force both isolated clients to generate a local single-player world utilizing the exact same randomly generated seed. In vanilla Minecraft, world creation is heavily tied to the CreateWorldScreen Graphical User Interface (GUI) and requires extensive manual user input to configure the level parameters.17 To bypass this manual intervention and automate the process, the mod must use Mixins to intercept the standard menu control flow and programmatically invoke the underlying world generation logic.

### **Bypassing the Title Screen and Initialization**

The entry point for this sequence occurs when the player clicks the custom "Find Match" button on the Title Screen. This button is injected via a Mixin targeting TitleScreen.init or TitleScreen.initWidgetsNormal, utilizing the addRenderableWidget or addButton methods depending on the specific Fabric mappings.18 When clicked, the background asynchronous thread negotiates the match via the REST API. Upon success, the thread receives the JSON payload containing the shared seed.

The mod must then entirely bypass the CreateWorldScreen. Instead of simulating mouse clicks or navigating through the standard GUI hierarchy, the mod directly constructs the required data structures for world generation. This involves deep interaction with the GeneratorOptions and LevelInfo classes. The GeneratorOptions class encapsulates the fundamental properties for world generation, dictating the seed, the generation of structures, and the presence of a bonus chest.20 A Mixin or a direct invocation must construct a new GeneratorOptions object, parsing the agreed-upon seed from the Firebase payload and passing it to the constructor.20

The construction of the physical world requires initializing the LevelInfo class, which holds the metadata necessary for the save file, such as the world name, game mode (which must be strictly locked to Survival for MCSR), difficulty, and hardcore status.22 By programmatically instantiating these objects and passing them directly to the MinecraftClient.getInstance().createWorld() method (or its equivalent in the target Fabric mapping), the mod forces the game engine to immediately transition from the matchmaking screen into the "Preparing for world creation..." loading state, bypassing all intermediate configuration menus.

### **Seed Determinism and Competitive Integrity**

Minecraft's world generation relies heavily on the provided seed value. A fundamental aspect of competitive Minecraft Speedrunning is ensuring that both players are subjected to the exact same terrain, structure placements, and mob spawn conditions. Because the architecture relies on local single-player worlds rather than a centralized server distributing chunk data, ensuring seed parity is critical.23

The matchmaking host generates a highly entropic random string to serve as the seed and pushes it to the /queue node. Both clients read this seed via the REST API. The Mixin responsible for injecting the seed into GeneratorOptions must ensure that no secondary random noise from the client's local system time bleeds into the generation algorithm.20 If the seed is strictly applied to the GeneratorOptions, Minecraft's highly deterministic procedural generation algorithms guarantee that the Ender Dragon, the Strongholds, the Nether fortresses, and the underlying biome layouts will be at identical mathematical coordinates for both players, forming the foundation of a fair 1v1 race.

## **The Paused Spawn Synchronization Protocol**

The most formidable obstacle in decentralized, client-hosted speedrunning is hardware disparity. A player utilizing a high-end NVMe Solid State Drive (SSD) paired with a modern processor will generate the terrain, load the chunks, and drop into the world significantly faster than a player utilizing an older mechanical Hard Disk Drive (HDD). If the match timer begins the moment the local world loads, the SSD player gains an insurmountable and unfair time advantage before the HDD player even sees the terrain. To guarantee a mathematically perfect start, the architecture introduces the "Paused Spawn" synchronization method.

### **Intercepting the Exact Millisecond of Spawn**

To execute the Paused Spawn, the mod must detect the precise tick the player entity is instantiated and placed into the generated world. Fabric provides several avenues for this interception. One approach is registering a listener to the ClientPlayConnectionEvents.JOIN event, which fires when the client successfully connects to the integrated server and the player entity is ready.25 However, for absolute precision, a more aggressive method involves mixing directly into the PlayerManager.onPlayerConnect method or the ClientPlayerEntity initialization sequence.27

When this specific injection point is reached, the player entity exists within the world, but no logical ticks have elapsed. At this exact microsecond, the mod must programmatically force open a custom GUI screen, referred to as the MatchWaitScreen.

### **Overriding the Rendering Pipeline and Game Tick**

In the Minecraft rendering engine, when a GUI screen is open, the game evaluates whether the underlying logical world should continue ticking. This behavior is governed by the shouldPause() method within the Screen class hierarchy.29 By default, inventory screens or chest interfaces do not pause the game, while the main pause menu (triggered by the Esc key) does.

The custom MatchWaitScreen must explicitly override this shouldPause() method to return true.29

When this screen is forcibly opened via MinecraftClient.getInstance().setScreen(new MatchWaitScreen()) upon initial world entry, the integrated server immediately halts its tick loop. The player's in-game timer is effectively frozen at precisely 0:00.00. Hostile mobs do not move, weather sequences do not progress, physics calculations are suspended, and the player cannot manipulate their camera or interact with the environment. The rendering pipeline continues to draw the background, allowing the player to observe their immediate spawn terrain, but all logical updates are entirely suspended.29

### **Database Handshake and Timestamp Calculation**

While the MatchWaitScreen is active and the local game engine is frozen, the client issues an asynchronous HTTP PATCH request to Firebase, updating their status key to "loaded".5 Simultaneously, a background execution thread begins polling the opponent's status node at an aggressive interval, typically utilizing a ScheduledExecutorService running every 250 to 500 milliseconds.31

Once the background thread determines that both player\_a.status and player\_b.status equal the "loaded" string, the final synchronization protocol triggers. To ensure both players unpause at the exact same millisecond regardless of geographical distance, network routing latency, or local hardware performance, the host client calculates a future Universal Time Coordinated (UTC) timestamp.

Relying on local system clocks via System.currentTimeMillis() is fundamentally flawed due to inevitable clock drift between the two distinct physical machines. Instead, the architecture must utilize Firebase's server-side timestamp generation capabilities. In a REST payload, passing ".sv": "timestamp" instructs the Firebase backend to write its own highly accurate, internal UNIX epoch timestamp into the database node.32

The host writes a start\_timestamp object to the /live\_matches node. The value is calculated as the synchronized Firebase server timestamp plus a fixed buffer (e.g., 10,000 milliseconds). Both clients, actively polling the match node, receive this start\_timestamp. The custom MatchWaitScreen reads this value and compares it to the continuously fetched server time, rendering a synchronized visual countdown on the screen interface. Because both clients are comparing the identical future UTC timestamp against the same synchronized time-server logic, the countdown is entirely independent of their local hardware performance.

At exactly T-Minus 0, the MatchWaitScreen executes this.close() or MinecraftClient.getInstance().setScreen(null). The closure of the screen inherently releases the shouldPause() lock, and the integrated server resumes ticking.29 Both players are released into the world at the exact same logical frame, resulting in a flawless, mathematically synchronized start to the speedrun.

## **Telemetry and Opponent Tracking via Advancements**

A critical component of a competitive 1v1 mod is the provision of spatial and temporal awareness regarding the opponent's progress. Because the players exist in entirely isolated, local single-player instances, standard multiplayer packets and entity trackers do not exist. Instead, the mod must scrape local gameplay milestones, transmit them as telemetry payloads to the Firebase database, and translate the opponent's incoming telemetry into distinct visual cues.

### **Hooking the PlayerAdvancementTracker**

In modern Minecraft speedrunning, progress is universally measured by the acquisition of specific in-game Advancements. Milestones such as entering the Nether dimension, locating the Stronghold, and entering the End dimension dictate the pace of the run.34 The most efficient and reliable method to track a player's progress without running expensive coordinate checks every tick is to hook directly into the game's internal advancement granting logic.

The class responsible for this logic is net.minecraft.advancement.PlayerAdvancementTracker. This class manages the progress of all criteria for a given player entity.36 By utilizing Mixins, the mod can inject code into the grantCriterion method.37 The specific Mixin signature targets Lnet/minecraft/advancement/PlayerAdvancementTracker;grantCriterion(Lnet/minecraft/advancement/AdvancementEntry;Ljava/lang/String;)Z.37

By injecting at the RETURN opcode and checking the boolean return value provided by the CallbackInfoReturnable, the mod ensures it only reacts when an advancement is *newly* granted, completely ignoring the re-evaluation of already completed criteria.39 The mod intercepts the AdvancementEntry object and evaluates its unique Identifier string. For example, it listens for minecraft:story/enter\_the\_nether or minecraft:story/follow\_ender\_eye.41

When a critical speedrunning milestone is identified by the Mixin, the asynchronous HTTP client immediately dispatches a PATCH request to the player's specific telemetry node in the Firebase tree. For example, it updates the database with {"nether\_entry": 645000}, where the value is the in-game millisecond timestamp representing when the milestone was achieved.

### **Asynchronous Polling and Toast Notifications**

Conversely, a dedicated background thread continuously polls the opponent's telemetry node to monitor their progress. It is imperative that this polling thread sleeps appropriately and does not saturate the network interface or block the Minecraft RenderSystem.

When the polling thread detects a change in the opponent's advancement state (for instance, the opponent's nether\_entry field populates in the JSON payload), it constructs a custom Toast notification. Minecraft's ToastManager handles the rendering of these popups in the top right corner of the client screen. Because User Interface rendering must strictly occur on the main thread, the background polling thread cannot invoke the ToastManager directly. It must safely pass the notification request to the main client thread via a synchronized execution queue or RenderSystem.recordRenderCall, ensuring thread safety while displaying the critical message: *"Opponent has entered the Nether\!"*.29

## **Win Condition Interception**

Defining the exact moment a Minecraft speedrun concludes is paramount to the integrity of the match. The accepted standard for an "Any%" random seed glitchless run is the death of the Ender Dragon and the player's subsequent entry into the Exit Portal to trigger the end credits sequence.35 In a decentralized mod environment, this highly specific condition must be detected locally, verified, and rapidly broadcasted to terminate the opponent's game.

### **Intercepting Ender Dragon Death**

The Ender Dragon boss fight involves incredibly complex, multi-part entity logic spread across several bounding boxes. The primary entity class is net.minecraft.entity.boss.dragon.EnderDragonEntity.44 The death sequence of the dragon is famously intricate, involving a lengthy animation where it rises along the Y-axis, emits beams of light, and slowly disintegrates over the course of exactly 200 ticks (10 seconds).45

To detect the absolute earliest frame of victory, the mod can inject into the onDeath method of the EnderDragonEntity class.15 However, speedrunners frequently utilize a strategy known as "bed bombing"—exploding beds near the dragon's head bounding box (EnderDragonPart) to deal massive burst damage due to intentional game design mechanics regarding beds in non-Overworld dimensions.47 Because beds deal environmental explosion damage differently than standard entity melee attacks, relying solely on the onDeath event may occasionally result in missed edge cases depending on how the damage source is attributed by the game engine.

A substantially more robust approach involves injecting into the tick or mobTick method of the EnderDragonEntity, actively monitoring the entity's underlying health variable on every server tick. The moment getHealth() \<= 0.0F and the death animation timer (tracked internally by DRAGON\_DEATH\_TIME\_KEY) initiates 44, the mod registers a provisional victory.

### **Exit Portal Entry Verification**

The definitive, irrefutable end of a Minecraft speedrun occurs when the player physically collides with the generated End Portal block, triggering the dimension change and the credits.50 This block is represented by the net.minecraft.block.EndPortalBlock class. The precise method to intercept is onEntityCollision, which takes the block state, the world context, the block position, and the entity colliding with it as parameters.51

The Mixin signature for this crucial interception targets Lnet/minecraft/block/AbstractBlock;onEntityCollision(Lnet/minecraft/block/BlockState;Lnet/minecraft/world/World;Lnet/minecraft/util/math/BlockPos;Lnet/minecraft/entity/Entity;)V.51

By injecting into onEntityCollision, the mod can verify if the colliding entity is an instance of ClientPlayerEntity.27 The exact microsecond this collision evaluates to true following the dragon's death, the run is considered complete. The client immediately records the final elapsed time and dispatches an aggressive, high-priority HTTP PUT request to the /history/{match\_id} node, formally recording themselves as the winner of the match.

### **Forcing the Match Termination**

Simultaneously, the winning client updates the shared /live\_matches node with a GAME\_OVER status flag. The opponent's client, upon polling this flag during its background loop, must immediately halt all gameplay. The mod forcefully strips control from the losing player by programmatically invoking a custom, unclosable "You Lost" GUI screen. Similar to the initial MatchWaitScreen, this defeat screen overrides shouldPause() to instantly freeze the integrated server, effectively acting as an impenetrable overlay that ends the run and displays the final time difference between the two competitors.29

## **Security, Anti-Cheat, and Environment Integrity**

Operating a competitive matchmaking mod in a decentralized, peer-to-peer environment introduces massive security vulnerabilities. Because there is no authoritative centralized server analyzing player movement packets or inventory data, the client itself is fundamentally untrusted. While preventing all forms of client-side modification is mathematically impossible without intrusive kernel-level rootkits, the architecture must implement robust "fair play" barriers to deter the vast majority of malicious actors.

### **Mod Enumeration and Verification**

The most common method of cheating in Minecraft involves loading unauthorized fabric mods alongside the legitimate client. Mods such as "Meteor Client", X-Ray texture packs, or "SeedcrackerX" completely destroy competitive integrity.53 SeedcrackerX is particularly devastating to the speedrunning format, as it passively monitors structures and biome layouts to reverse-engineer the 48-bit world seed, allowing the player to instantly calculate the coordinates of the Stronghold and the End Portal without utilizing Eyes of Ender.53

To combat this, the matchmaking mod must perform an internal audit of the loaded environment. The Fabric Loader API provides a mechanism to retrieve a comprehensive list of all currently loaded mods at runtime via FabricLoader.getInstance().getAllMods().57 This method returns a collection of ModContainer objects representing every active modification.57

During the initial matchmaking handshake, the mod iterates through the getAllMods() collection, extracting the Metadata.getId() of every loaded jar. It hashes this list and transmits it to the Firebase database. If the mod detects blacklisted identifiers (e.g., seedcrackerx, meteor-client, xray), it immediately aborts the network connection and refuses to patch into the /queue. While highly sophisticated malicious actors can spoof the Mod ID in their own fabric.mod.json configuration file, this basic enumeration effectively blocks casual cheating attempts.59

### **World Seed Integrity**

Even if a player does not actively use a cracking mod, they may attempt to illicitly extract the generated seed to use external mapping tools like Chunkbase.53 Because the mod programmatically injects the seed during world generation via the GeneratorOptions Hook, it is already hidden from the standard F3 debug menu.60 However, players could attempt to use the vanilla /seed command.

The mod must strictly enforce a command-interception Mixin, hooking into CommandOutput.sendMessage or directly overriding the server-side command registration to disable /seed entirely within the integrated server.27 Furthermore, the mod should utilize a background thread to calculate a secondary hash of the current world's generated terrain chunks—essentially creating a localized checksum—and compare it against a predicted hash derived from the Firebase seed. If the checksums drift, it indicates the client has locally altered world generation parameters, and the match is immediately invalidated.

## **Resilience, Recovery, and Dashboard Expansions**

The reality of peer-to-peer internet infrastructure dictates that HTTPS connections to Firebase will occasionally drop, or the Java client may encounter an out-of-memory exception and crash. In a standard single-player speedrun, a client crash is heavily penalized or invalidates the run entirely. In this synchronized 1v1 architecture, a robust reconnection logic is required to salvage the match without compromising fairness.

### **Crash Recovery and Resynchronization**

If Player A's client crashes, their continuous polling loop to Firebase ceases. Player B's client, noticing the absence of recent heartbeat timestamps or state updates from Player A, will automatically pause their local game by invoking a variation of the MatchWaitScreen and displaying an "Opponent Disconnected" alert.29

Upon relaunching the Minecraft client, Player A's mod queries the /live\_matches database node. Detecting an active match bound to their universally unique identifier (UUID) or Hardware ID, it skips the main menu and forcefully reloads the single-player world save. Because Minecraft natively saves player position, health, and inventory data to the local disk via NBT files, Player A spawns exactly where they crashed.

Once Player A's status returns to "loaded", the MatchWaitScreen on both clients initiates a new synchronized countdown utilizing the same ServerValue.TIMESTAMP logic detailed previously. This guarantees that neither player loses or gains in-game time during the network or hardware outage, preserving the strict competitive integrity of the run.

### **Data Structuring for the Web Dashboard**

A secondary benefit of using Firebase RTDB as the primary state machine is the seamless integration it affords for external web applications. Because the matchmaking mod operates entirely via REST APIs, a standard React or Vue.js frontend can interact with the exact same database infrastructure without any translation layer.

The schema design of the /history node is explicitly tailored for this future web consumption. By appending a match record sequentially upon the validation of the End Portal collision, the web dashboard can utilize Firebase's native SDK to bind a realtime listener to the history node. This allows for the automatic generation of global leaderboards, win/loss ratios, and historical match times without requiring a secondary backend database. The web frontend simply parses the winning\_time and loser strings to construct Elo rankings, bridging the gap between an isolated Minecraft client modification and a fully-featured competitive web ecosystem.

Through meticulous bytecode manipulation, lightweight REST integration, and strict rendering pipeline overrides, this serverless architecture successfully synthesizes the fluid performance of local single-player generation with the rigorous competitive synchronicity of a heavily moderated multiplayer environment.

#### **Works cited**

1. Introduction to Mixins (WIP) \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/tutorial:mixin\_introduction](https://wiki.fabricmc.net/tutorial:mixin_introduction)  
2. Events | Fabric Documentation, accessed April 5, 2026, [https://docs.fabricmc.net/develop/events](https://docs.fabricmc.net/develop/events)  
3. SrejonKhan/FirebaseRestClient: Lightweight Firebase Library for Unity, made on top of REST API. \- GitHub, accessed April 5, 2026, [https://github.com/SrejonKhan/FirebaseRestClient](https://github.com/SrejonKhan/FirebaseRestClient)  
4. Retrieving Data | Firebase Realtime Database \- Google, accessed April 5, 2026, [https://firebase.google.com/docs/database/rest/retrieve-data](https://firebase.google.com/docs/database/rest/retrieve-data)  
5. Saving Data | Firebase Realtime Database \- Google, accessed April 5, 2026, [https://firebase.google.com/docs/database/rest/save-data](https://firebase.google.com/docs/database/rest/save-data)  
6. SDKs and client libraries | Firestore \- Firebase, accessed April 5, 2026, [https://firebase.google.com/docs/firestore/client/libraries](https://firebase.google.com/docs/firestore/client/libraries)  
7. IntellectualSites/HTTP4J: Simple & Lightweight Java 8 HTTP Client \- GitHub, accessed April 5, 2026, [https://github.com/IntellectualSites/HTTP4J](https://github.com/IntellectualSites/HTTP4J)  
8. Exploring Java HTTP Clients for Modern Web Applications | by Alex Klimenko | Medium, accessed April 5, 2026, [https://medium.com/@alxkm/exploring-java-http-clients-for-modern-web-applications-b9c991c70454](https://medium.com/@alxkm/exploring-java-http-clients-for-modern-web-applications-b9c991c70454)  
9. Posting with Java HttpClient | Baeldung, accessed April 5, 2026, [https://www.baeldung.com/java-httpclient-post](https://www.baeldung.com/java-httpclient-post)  
10. Java HTTP Client \- Examples and Recipes \- OpenJDK, accessed April 5, 2026, [https://openjdk.org/groups/net/httpclient/recipes.html](https://openjdk.org/groups/net/httpclient/recipes.html)  
11. Mixins Tutorial For Fabric/Forge \[Advanced\] \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=HQUkWjMWTik](https://www.youtube.com/watch?v=HQUkWjMWTik)  
12. Fabric Loader \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/documentation:fabric\_loader](https://wiki.fabricmc.net/documentation:fabric_loader)  
13. Registering Mixins \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/tutorial:mixin\_registration](https://wiki.fabricmc.net/tutorial:mixin_registration)  
14. Creating a Mixin, accessed April 5, 2026, [https://stationapi.wiki/Mixins/Creating-a-Mixin](https://stationapi.wiki/Mixins/Creating-a-Mixin)  
15. Problems With Overwriting onDeath Method in LivingEntity : r/fabricmc \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/fabricmc/comments/e9jcfh/problems\_with\_overwriting\_ondeath\_method\_in/](https://www.reddit.com/r/fabricmc/comments/e9jcfh/problems_with_overwriting_ondeath_method_in/)  
16. Firebase Database REST API, accessed April 5, 2026, [https://firebase.google.com/docs/reference/rest/database](https://firebase.google.com/docs/reference/rest/database)  
17. Package net.minecraft.client.gui.screen.world \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.20.1-rc1+build.2/net/minecraft/client/gui/screen/world/package-summary.html](https://maven.fabricmc.net/docs/yarn-1.20.1-rc1+build.2/net/minecraft/client/gui/screen/world/package-summary.html)  
18. Creating a screen \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/tutorial:screen](https://wiki.fabricmc.net/tutorial:screen)  
19. I need help with adding a button to the main menu · FabricMC · Discussion \#1795 \- GitHub, accessed April 5, 2026, [https://github.com/orgs/FabricMC/discussions/1795](https://github.com/orgs/FabricMC/discussions/1795)  
20. GeneratorOptions (yarn 1.20-pre5+build.1 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.20-pre5+build.1/net/minecraft/world/gen/GeneratorOptions.html](https://maven.fabricmc.net/docs/yarn-1.20-pre5+build.1/net/minecraft/world/gen/GeneratorOptions.html)  
21. Tutorial: Making your first Mixin \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/tutorial:mixin\_your\_first\_mixin](https://wiki.fabricmc.net/tutorial:mixin_your_first_mixin)  
22. Uses of Class net.minecraft.world.level.LevelInfo \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.17-pre1+build.1/net/minecraft/world/level/class-use/LevelInfo.html](https://maven.fabricmc.net/docs/yarn-1.17-pre1+build.1/net/minecraft/world/level/class-use/LevelInfo.html)  
23. How To Generate A Multiplayer Minecraft Server Or Singleplayer Minecraft World Using A Level-Seed \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=bgwVHW8fwG0](https://www.youtube.com/watch?v=bgwVHW8fwG0)  
24. How to a Minecraft World With a Custom Seed | by Britt Andreotta | Medium, accessed April 5, 2026, [https://medium.com/@brittandreotta/how-to-create-a-world-with-a-custom-seed-8855e476a64d](https://medium.com/@brittandreotta/how-to-create-a-world-with-a-custom-seed-8855e476a64d)  
25. I don't understand, how can I listen to events in FabricMC (1.20) \- Stack Overflow, accessed April 5, 2026, [https://stackoverflow.com/questions/78741447/i-dont-understand-how-can-i-listen-to-events-in-fabricmc-1-20](https://stackoverflow.com/questions/78741447/i-dont-understand-how-can-i-listen-to-events-in-fabricmc-1-20)  
26. Detecting Player Joins in Minecraft with a Client-Side Solution \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=94Z9LiDfNb4](https://www.youtube.com/watch?v=94Z9LiDfNb4)  
27. ClientPlayerEntity (yarn 1.20+build.1 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.20+build.1/net/minecraft/client/network/ClientPlayerEntity.html](https://maven.fabricmc.net/docs/yarn-1.20+build.1/net/minecraft/client/network/ClientPlayerEntity.html)  
28. How do I check if a player joined a single-player world using "onPlayerConnect" from the player-manager class : r/fabricmc \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/fabricmc/comments/qet6w6/how\_do\_i\_check\_if\_a\_player\_joined\_a\_singleplayer/](https://www.reddit.com/r/fabricmc/comments/qet6w6/how_do_i_check_if_a_player_joined_a_singleplayer/)  
29. Custom Screens | Fabric Documentation, accessed April 5, 2026, [https://docs.fabricmc.net/develop/rendering/gui/custom-screens](https://docs.fabricmc.net/develop/rendering/gui/custom-screens)  
30. How to make a GUI not pause the game. \- Modder Support \- Minecraft Forge Forums, accessed April 5, 2026, [https://forums.minecraftforge.net/topic/11080-how-to-make-a-gui-not-pause-the-game/](https://forums.minecraftforge.net/topic/11080-how-to-make-a-gui-not-pause-the-game/)  
31. Using ServerValue.TIMESTAMP for a countdown in Realtime Database : r/Firebase \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/Firebase/comments/pl8fjs/using\_servervaluetimestamp\_for\_a\_countdown\_in/](https://www.reddit.com/r/Firebase/comments/pl8fjs/using_servervaluetimestamp_for_a_countdown_in/)  
32. Save ServerValue.TIMESTAMP as string in realtime database \- Stack Overflow, accessed April 5, 2026, [https://stackoverflow.com/questions/56515727/save-servervalue-timestamp-as-string-in-realtime-database](https://stackoverflow.com/questions/56515727/save-servervalue-timestamp-as-string-in-realtime-database)  
33. Advancements Generation \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/tutorial:datagen\_advancements](https://wiki.fabricmc.net/tutorial:datagen_advancements)  
34. Has anyone attempted to speedrun minecraft while getting as few achievements as possible? \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/Minecraft/comments/q53rew/has\_anyone\_attempted\_to\_speedrun\_minecraft\_while/](https://www.reddit.com/r/Minecraft/comments/q53rew/has_anyone_attempted_to_speedrun_minecraft_while/)  
35. Minecraft All Advancements Speedrun Guide \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=yFAMGsNnKXY](https://www.youtube.com/watch?v=yFAMGsNnKXY)  
36. Uses of Class net.minecraft.advancement.PlayerAdvancementTracker \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-22w14a+build.2/net/minecraft/advancement/class-use/PlayerAdvancementTracker.html](https://maven.fabricmc.net/docs/yarn-22w14a+build.2/net/minecraft/advancement/class-use/PlayerAdvancementTracker.html)  
37. PlayerAdvancementTracker (yarn 1.20.5+build.1 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.20.5+build.1/net/minecraft/advancement/PlayerAdvancementTracker.html](https://maven.fabricmc.net/docs/yarn-1.20.5+build.1/net/minecraft/advancement/PlayerAdvancementTracker.html)  
38. PlayerAdvancementTracker (yarn 1.21.4+build.1 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.21.4+build.1/net/minecraft/advancement/PlayerAdvancementTracker.html](https://maven.fabricmc.net/docs/yarn-1.21.4+build.1/net/minecraft/advancement/PlayerAdvancementTracker.html)  
39. Only some mixins are being applied to target class : r/fabricmc \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/fabricmc/comments/1d1cvp8/only\_some\_mixins\_are\_being\_applied\_to\_target\_class/](https://www.reddit.com/r/fabricmc/comments/1d1cvp8/only_some_mixins_are_being_applied_to_target_class/)  
40. Inject \- Fabric Wiki, accessed April 5, 2026, [https://wiki.fabricmc.net/tutorial:mixin\_injects](https://wiki.fabricmc.net/tutorial:mixin_injects)  
41. Advancements | NeoForged docs, accessed April 5, 2026, [https://docs.neoforged.net/docs/resources/server/advancements](https://docs.neoforged.net/docs/resources/server/advancements)  
42. Adding to Minecraft's vanilla advancements : r/fabricmc \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/fabricmc/comments/1cfu5fm/adding\_to\_minecrafts\_vanilla\_advancements/](https://www.reddit.com/r/fabricmc/comments/1cfu5fm/adding_to_minecrafts_vanilla_advancements/)  
43. MINECRAFT SPEEDRUN in 15 MINUTES\! \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=TBmF2jG9g3Q](https://www.youtube.com/watch?v=TBmF2jG9g3Q)  
44. EnderDragonEntity (yarn 1.21.11+build.1 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.21.11+build.1/net/minecraft/entity/boss/dragon/EnderDragonEntity.html](https://maven.fabricmc.net/docs/yarn-1.21.11+build.1/net/minecraft/entity/boss/dragon/EnderDragonEntity.html)  
45. Entity Documentation \- minecraft:behavior.dragondeath \- Microsoft Learn, accessed April 5, 2026, [https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/entitygoals/minecraftbehavior\_dragondeath?view=minecraft-bedrock-stable](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/entitygoals/minecraftbehavior_dragondeath?view=minecraft-bedrock-stable)  
46. after the dragon's death if your in the end fountain you should just place water so no endermen can hit you : r/MinecraftSpeedrun \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/MinecraftSpeedrun/comments/1qzguht/after\_the\_dragons\_death\_if\_your\_in\_the\_end/](https://www.reddit.com/r/MinecraftSpeedrun/comments/1qzguht/after_the_dragons_death_if_your_in_the_end/)  
47. how do you beat the ender dragon quickly in 1.8? : r/MinecraftSpeedrun \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/MinecraftSpeedrun/comments/1d7ekpe/how\_do\_you\_beat\_the\_ender\_dragon\_quickly\_in\_18/](https://www.reddit.com/r/MinecraftSpeedrun/comments/1d7ekpe/how_do_you_beat_the_ender_dragon_quickly_in_18/)  
48. 1.16 Enderdragon Speedrun (How to kill it on its first landing) : r/Minecraft \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/Minecraft/comments/hxhros/116\_enderdragon\_speedrun\_how\_to\_kill\_it\_on\_its/](https://www.reddit.com/r/Minecraft/comments/hxhros/116_enderdragon_speedrun_how_to_kill_it_on_its/)  
49. Ender Dragon Death Trap \- Simple, Safe, and Fast : r/technicalminecraft \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/technicalminecraft/comments/kt7pud/ender\_dragon\_death\_trap\_simple\_safe\_and\_fast/](https://www.reddit.com/r/technicalminecraft/comments/kt7pud/ender_dragon_death_trap_simple_safe_and_fast/)  
50. Exit portal \- Minecraft Wiki \- Fandom, accessed April 5, 2026, [https://minecraft.fandom.com/wiki/Exit\_portal](https://minecraft.fandom.com/wiki/Exit_portal)  
51. EndPortalBlock (yarn 1.19.1+build.5 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-1.19.1+build.5/net/minecraft/block/EndPortalBlock.html](https://maven.fabricmc.net/docs/yarn-1.19.1+build.5/net/minecraft/block/EndPortalBlock.html)  
52. EndPortalBlock (yarn 24w14potato+build.3 API) \- Fabric, accessed April 5, 2026, [https://maven.fabricmc.net/docs/yarn-24w14potato+build.3/net/minecraft/block/EndPortalBlock.html](https://maven.fabricmc.net/docs/yarn-24w14potato+build.3/net/minecraft/block/EndPortalBlock.html)  
53. How to Find Minecraft Seed on Server Without OP \- Apex Hosting, accessed April 5, 2026, [https://apexminecrafthosting.com/guides/general/how-to-find-minecraft-seed-on-server-without-op/](https://apexminecrafthosting.com/guides/general/how-to-find-minecraft-seed-on-server-without-op/)  
54. Ways to find server seed/by pass anti Seedcracker. : r/technicalminecraft \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/technicalminecraft/comments/11ezoqj/ways\_to\_find\_server\_seedby\_pass\_anti\_seedcracker/](https://www.reddit.com/r/technicalminecraft/comments/11ezoqj/ways_to_find_server_seedby_pass_anti_seedcracker/)  
55. Anti Xray Bypass 1.17.1 || Oresim Showcase || World Seed based \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=nv3wevLjiwo](https://www.youtube.com/watch?v=nv3wevLjiwo)  
56. How to get Seed of every Minecraft Server 2026 \- YouTube, accessed April 5, 2026, [https://www.youtube.com/watch?v=EoLeHUbQrDE](https://www.youtube.com/watch?v=EoLeHUbQrDE)  
57. FabricLoader (fabric-loader 0.14.0 API), accessed April 5, 2026, [https://maven.fabricmc.net/docs/fabric-loader-0.14.0/net/fabricmc/loader/api/FabricLoader.html](https://maven.fabricmc.net/docs/fabric-loader-0.14.0/net/fabricmc/loader/api/FabricLoader.html)  
58. Fabric Loader \- HackMD, accessed April 5, 2026, [https://hackmd.io/@i509VCB/By6rO8sMw](https://hackmd.io/@i509VCB/By6rO8sMw)  
59. Fabric servers \- how to get list of mods the client has? : r/admincraft \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/admincraft/comments/mx1fo2/fabric\_servers\_how\_to\_get\_list\_of\_mods\_the\_client/](https://www.reddit.com/r/admincraft/comments/mx1fo2/fabric_servers_how_to_get_list_of_mods_the_client/)  
60. I was told I can find seed on Java edition by pressing F3. I don't see it here... anyone help? : r/Minecraft \- Reddit, accessed April 5, 2026, [https://www.reddit.com/r/Minecraft/comments/fx58s6/i\_was\_told\_i\_can\_find\_seed\_on\_java\_edition\_by/](https://www.reddit.com/r/Minecraft/comments/fx58s6/i_was_told_i_can_find_seed_on_java_edition_by/)