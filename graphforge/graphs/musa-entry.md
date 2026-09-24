# Musa — Graph Engineering Entry (routing to the six canonical playbooks)

<!-- GraphForge live mirror. This mermaid block is the single source of truth.
     Node positions persist in `%% @pos id x y` comments, drill-downs in `%% @link id graph-name`. Edit by hand or by AI: -->

```mermaid
flowchart TD
    subgraph INPUT["Musa entry · one objective at a time"]
        E1[User objective in natural language]
        E2{Classify · what did the human hand us?}
    end
    subgraph PLAYBOOKS["Six canonical playbooks · docs/GRAPH_PLAYBOOK_*.md"]
        PB1[replicate-html · full HTML+CSS document + template name hint]
        PB2[create-from-scratch · blank slate, reference or description]
        PB3[csv-batch · CSV source + base template]
        PB4[design-system · templateIds + brandName]
        PB5[multi-agent · one template + several agents + sections]
        PB6[content-calendar · propose posts, human approves, design batch]
    end
    subgraph SHARED["Shared infrastructure · every playbook runs on these"]
        AUTH((x-api-key fdr_ws_*))
        CLAIM((claim_section · exclusive locks))
        LINT{lint_design gate}
        HUMAN{human gate · approval in the UI}
        PG((provenance graph))
    end

    E1 --> E2
    E2 -->|complete HTML+CSS document| PB1
    E2 -->|idea or description, no document| PB2
    E2 -->|rows of data in a CSV| PB3
    E2 -->|extract tokens into a brand| PB4
    E2 -->|parallel agents on one template| PB5
    E2 -->|plan a month of content| PB6

    %% @pos E1 40 40
    %% @pos E2 40 210
    %% @pos PB1 40 380
    %% @pos PB2 493 380
    %% @pos PB3 907 380
    %% @pos PB4 1220 380
    %% @pos PB5 1551 380
    %% @pos PB6 1951 380
    %% @pos AUTH 322 40
    %% @pos CLAIM 527 40
    %% @pos LINT 797 40
    %% @pos HUMAN 1024 40
    %% @pos PG 1342 40
    %% @link PB1 musa-pb-replicate-html
    %% @link PB2 musa-pb-create-from-scratch
    %% @link PB3 musa-pb-csv-batch
    %% @link PB4 musa-pb-design-system
    %% @link PB5 musa-pb-multi-agent
    %% @link PB6 musa-pb-content-calendar
```
