// SPDX-License-Identifier: Apache-2.0
// Run with Ghidra's analyzeHeadless -postScript option.

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolType;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Exports the smallest stable evidence snapshot needed by RetroPort.
 *
 * The script deliberately emits one marker line and keeps diagnostic output
 * separate. The TypeScript adapter can therefore ignore normal Ghidra logs
 * while still treating the JSON line as the versioned machine boundary.
 */
public class RetroPortSnapshot extends GhidraScript {
    private static final String MARKER = "RETROPORT_SNAPSHOT=";
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();

    @Override
    public void run() throws Exception {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("program", exportProgram());
        snapshot.put("memoryBlocks", exportMemoryBlocks());

        Map<String, Set<String>> callersByCallee = new TreeMap<>();
        List<Map<String, Object>> xrefs = new ArrayList<>();
        List<Map<String, Object>> functions = exportFunctions(callersByCallee, xrefs);
        for (Map<String, Object> function : functions) {
            String address = (String) function.get("address");
            function.put("callers", new ArrayList<>(callersByCallee.getOrDefault(address, Collections.emptySet())));
        }
        xrefs.sort(Comparator.comparing(this::xrefSortKey));

        snapshot.put("functions", functions);
        snapshot.put("xrefs", xrefs);
        snapshot.put("strings", exportStrings());
        snapshot.put("symbols", exportSymbols());
        // Hardware classification is intentionally conservative until a
        // target-specific address map is supplied by the caller.
        snapshot.put("hardwareAccessCandidates", new ArrayList<>());

        println(MARKER + gson.toJson(snapshot));
    }

    private Map<String, Object> exportProgram() {
        Map<String, Object> program = new LinkedHashMap<>();
        program.put("format", currentProgram.getExecutableFormat());
        program.put("languageId", currentProgram.getLanguage().getLanguageID().toString());
        program.put("imageBase", currentProgram.getImageBase().toString());
        return program;
    }

    private List<Map<String, Object>> exportMemoryBlocks() {
        List<MemoryBlock> sourceBlocks = new ArrayList<>();
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            sourceBlocks.add(block);
        }
        sourceBlocks.sort(Comparator.comparing(block -> block.getStart().getOffset()));

        List<Map<String, Object>> blocks = new ArrayList<>();
        for (MemoryBlock block : sourceBlocks) {
            Map<String, Object> exported = new LinkedHashMap<>();
            exported.put("name", block.getName());
            exported.put("start", block.getStart().toString());
            exported.put("end", block.getEnd().toString());
            exported.put("permissions", permissions(block));
            blocks.add(exported);
        }
        return blocks;
    }

    private String permissions(MemoryBlock block) {
        return (block.isRead() ? "r" : "-")
            + (block.isWrite() ? "w" : "-")
            + (block.isExecute() ? "x" : "-");
    }

    private List<Map<String, Object>> exportFunctions(
        Map<String, Set<String>> callersByCallee,
        List<Map<String, Object>> xrefs
    ) {
        List<Function> sourceFunctions = new ArrayList<>();
        FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
        while (iterator.hasNext()) {
            sourceFunctions.add(iterator.next());
        }
        sourceFunctions.sort(Comparator.comparing(function -> function.getEntryPoint().getOffset()));

        List<Map<String, Object>> functions = new ArrayList<>();
        for (Function function : sourceFunctions) {
            Map<String, Object> exported = new LinkedHashMap<>();
            exported.put("address", function.getEntryPoint().toString());
            exported.put("ghidraName", function.getName());
            exported.put("size", Math.min(Integer.MAX_VALUE, function.getBody().getNumAddresses()));
            exported.put("callers", new ArrayList<>());
            exported.put("callees", new ArrayList<>());

            Set<String> callees = new TreeSet<>();
            List<Map<String, Object>> reads = new ArrayList<>();
            List<Map<String, Object>> writes = new ArrayList<>();
            List<String> disassembly = new ArrayList<>();
            InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
            while (instructions.hasNext()) {
                Instruction instruction = instructions.next();
                disassembly.add(instruction.toString());
                for (Reference reference : instruction.getReferencesFrom()) {
                    String from = instruction.getAddress().toString();
                    String to = reference.getToAddress().toString();
                    xrefs.add(xref(from, to, reference.getReferenceType().toString()));
                    if (reference.getReferenceType().isCall()) {
                        Function callee = currentProgram.getFunctionManager()
                            .getFunctionContaining(reference.getToAddress());
                        if (callee != null) {
                            String calleeAddress = callee.getEntryPoint().toString();
                            callees.add(calleeAddress);
                            callersByCallee.computeIfAbsent(calleeAddress, ignored -> new TreeSet<>())
                                .add(function.getEntryPoint().toString());
                        }
                    }
                    if (reference.getReferenceType().isRead()) {
                        reads.add(memoryAccess(to));
                    }
                    if (reference.getReferenceType().isWrite()) {
                        writes.add(memoryAccess(to));
                    }
                }
            }
            reads.sort(Comparator.comparing(access -> (String) access.get("address")));
            writes.sort(Comparator.comparing(access -> (String) access.get("address")));
            exported.put("reads", reads);
            exported.put("writes", writes);
            exported.put("disassembly", String.join("\n", disassembly));
            String decompilation = decompile(function);
            if (decompilation != null && !decompilation.isEmpty()) {
                exported.put("decompilation", decompilation);
            }
            exported.put("callees", new ArrayList<>(callees));
            functions.add(exported);
        }
        return functions;
    }

    private Map<String, Object> xref(String from, String to, String kind) {
        Map<String, Object> xref = new LinkedHashMap<>();
        xref.put("from", from);
        xref.put("to", to);
        xref.put("kind", kind);
        return xref;
    }

    private String xrefSortKey(Map<String, Object> xref) {
        return xref.get("from") + ":" + xref.get("to") + ":" + xref.get("kind");
    }

    private Map<String, Object> memoryAccess(String address) {
        Map<String, Object> access = new LinkedHashMap<>();
        access.put("address", address);
        // Ghidra references identify the target address, not a complete type
        // width. A one-byte access is the conservative schema representation.
        access.put("size", 1);
        return access;
    }

    private String decompile(Function function) {
        DecompInterface decompiler = new DecompInterface();
        try {
            if (!decompiler.openProgram(currentProgram)) {
                return null;
            }
            DecompileResults result = decompiler.decompileFunction(function, 30, monitor);
            if (!result.decompileCompleted() || result.getDecompiledFunction() == null) {
                return null;
            }
            return result.getDecompiledFunction().getC();
        } catch (Exception ignored) {
            // A missing decompiler backend should not discard disassembly and
            // references, which are still valid evidence.
            return null;
        } finally {
            decompiler.dispose();
        }
    }

    private List<Map<String, Object>> exportStrings() {
        List<Data> sourceStrings = new ArrayList<>();
        DataIterator sourceData = currentProgram.getListing().getDefinedData(true);
        while (sourceData.hasNext()) {
            Data data = sourceData.next();
            if (data.getValue() instanceof String) {
                sourceStrings.add(data);
            }
        }
        sourceStrings.sort(Comparator.comparing(data -> data.getAddress().getOffset()));

        List<Map<String, Object>> strings = new ArrayList<>();
        for (Data data : sourceStrings) {
            String value = (String) data.getValue();
            Map<String, Object> string = new LinkedHashMap<>();
            string.put("address", data.getAddress().toString());
            string.put("value", value);
            strings.add(string);
        }
        return strings;
    }

    private List<Map<String, Object>> exportSymbols() {
        List<Symbol> sourceSymbols = new ArrayList<>();
        SymbolIterator sourceIterator = currentProgram.getSymbolTable().getAllSymbols(true);
        while (sourceIterator.hasNext()) {
            sourceSymbols.add(sourceIterator.next());
        }
        sourceSymbols.sort(Comparator
            .comparing((Symbol symbol) -> symbol.getAddress().getOffset())
            .thenComparing(Symbol::getName)
            .thenComparing(symbol -> symbol.getSymbolType().toString()));

        List<Map<String, Object>> symbols = new ArrayList<>();
        for (Symbol symbol : sourceSymbols) {
            SymbolType type = symbol.getSymbolType();
            Map<String, Object> exported = new LinkedHashMap<>();
            exported.put("address", symbol.getAddress().toString());
            exported.put("name", symbol.getName());
            exported.put("type", type.toString());
            symbols.add(exported);
        }
        return symbols;
    }
}
