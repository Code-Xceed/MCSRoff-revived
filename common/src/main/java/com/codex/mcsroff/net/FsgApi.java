package com.codex.mcsroff.net;

import com.codex.mcsroff.seed.FsgApiException;
import com.codex.mcsroff.seed.FsgCooldownException;
import com.codex.mcsroff.seed.FsgFilter;
import com.codex.mcsroff.seed.FsgTokenCheckResult;
import com.codex.mcsroff.seed.SeedAssignment;
import com.codex.mcsroff.seed.SeedMode;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class FsgApi {
    private static final Random RANDOM = new Random();

    private final String baseUrl;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public FsgApi(String baseUrl) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }

    public String getBaseUrl() {
        return this.baseUrl;
    }

    public CompletableFuture<List<FsgFilter>> fetchFilters() {
        return CompletableFuture.supplyAsync(new java.util.function.Supplier<List<FsgFilter>>() {
            @Override
            public List<FsgFilter> get() {
                JsonObject response = FsgApi.this.get("/filters");
                ensureSuccess(response);

                JsonArray filters = response.getAsJsonArray("filters");
                List<FsgFilter> parsedFilters = new ArrayList<FsgFilter>(filters.size());
                for (JsonElement element : filters) {
                    JsonObject filter = element.getAsJsonObject();
                    parsedFilters.add(new FsgFilter(
                            filter.get("id").getAsString(),
                            filter.get("displayName").getAsString(),
                            readStringArray(filter.getAsJsonArray("supportedVersions")),
                            filter.get("maxGenerating").getAsInt(),
                            getBoolean(filter, "runIsRetimed"),
                            getBoolean(filter, "hasCooldownScaling")
                    ));
                }
                return Collections.unmodifiableList(parsedFilters);
            }
        }, this.executor);
    }

    public CompletableFuture<SeedAssignment> requestSeed(final List<String> filterIds, final SeedMode seedMode) {
        if (filterIds == null || filterIds.isEmpty()) {
            throw new IllegalArgumentException("At least one filter id is required");
        }

        final List<String> normalizedFilters = new ArrayList<String>(filterIds);
        return CompletableFuture.supplyAsync(new java.util.function.Supplier<SeedAssignment>() {
            @Override
            public SeedAssignment get() {
                if (seedMode == SeedMode.MATCH) {
                    return requestMatchSeed(normalizedFilters);
                }
                return requestPracticeSeed(normalizedFilters);
            }
        }, this.executor);
    }

    public CompletableFuture<SeedAssignment> requestSeed(String filterId, SeedMode seedMode) {
        return requestSeed(Collections.singletonList(filterId), seedMode);
    }

    public CompletableFuture<FsgTokenCheckResult> checkToken(final String token) {
        if (token == null || token.trim().isEmpty()) {
            throw new IllegalArgumentException("Token must not be blank");
        }

        return CompletableFuture.supplyAsync(new java.util.function.Supplier<FsgTokenCheckResult>() {
            @Override
            public FsgTokenCheckResult get() {
                JsonObject response = FsgApi.this.get("/checkToken/" + urlEncode(token));
                ensureSuccess(response);
                return new FsgTokenCheckResult(
                        token,
                        response.get("seed").getAsString(),
                        response.get("filter").getAsString(),
                        response.get("time").getAsLong()
                );
            }
        }, this.executor);
    }

    private SeedAssignment requestMatchSeed(List<String> filterIds) {
        JsonObject response;
        if (filterIds.size() == 1) {
            response = get("/getSeed/" + urlEncode(filterIds.get(0)));
        } else {
            StringBuilder builder = new StringBuilder("/getSeedRandomFilter?");
            for (int i = 0; i < filterIds.size(); i++) {
                if (i > 0) {
                    builder.append('&');
                }
                builder.append("filters=").append(urlEncode(filterIds.get(i)));
            }
            response = get(builder.toString());
        }

        ensureSuccess(response);
        JsonObject data = response.getAsJsonObject("data");
        String filterId = data.has("filter") ? data.get("filter").getAsString() : filterIds.get(0);
        return new SeedAssignment(
                data.get("seed").getAsString(),
                filterId,
                data.get("token").getAsString(),
                SeedMode.MATCH
        );
    }

    private SeedAssignment requestPracticeSeed(List<String> filterIds) {
        String filterId = filterIds.size() == 1 ? filterIds.get(0) : filterIds.get(RANDOM.nextInt(filterIds.size()));
        JsonObject response = get("/getRandomUsedSeed/" + urlEncode(filterId));
        ensureSuccess(response);
        return new SeedAssignment(
                response.get("seed").getAsString(),
                filterId,
                null,
                SeedMode.PRACTICE
        );
    }

    private JsonObject get(String path) {
        try {
            return HttpJsonClient.getJson(this.baseUrl + path);
        } catch (RuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new FsgApiException("Failed to call FSG endpoint " + path, exception);
        }
    }

    private static void ensureSuccess(JsonObject response) {
        String type = response.has("type") ? response.get("type").getAsString() : "ERROR";
        if ("SUCCESS".equals(type)) {
            return;
        }
        if ("COOLDOWN".equals(type)) {
            throw new FsgCooldownException(response.get("cooldown").getAsLong());
        }

        String message = response.has("errorMessage") ? response.get("errorMessage").getAsString() : "Unknown FSG error";
        throw new FsgApiException(message);
    }

    private static List<String> readStringArray(JsonArray values) {
        List<String> result = new ArrayList<String>();
        if (values == null) {
            return result;
        }
        for (JsonElement value : values) {
            result.add(value.getAsString());
        }
        return result;
    }

    private static boolean getBoolean(JsonObject object, String key) {
        return object.has(key) && object.get(key).getAsBoolean();
    }

    private static String normalizeBaseUrl(String url) {
        if (url.endsWith("/")) {
            return url.substring(0, url.length() - 1);
        }
        return url;
    }

    private static String urlEncode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
